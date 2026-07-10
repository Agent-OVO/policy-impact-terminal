import * as cheerio from "cheerio";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeSourceText, sha256Text } from "./report-revision-core.mjs";

const execFileAsync = promisify(execFile);
const MIN_SOURCE_TEXT_LENGTH = 280;
const DEFAULT_TIMEOUT_MS = 30_000;
const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);

const SOURCE_PROFILES = [
  {
    key: "gov_zhengce_latest",
    hosts: ["www.gov.cn", "gov.cn"],
    selectors: ["#UCAP-CONTENT", ".pages_content", ".TRS_Editor", "#Zoom", ".article"]
  },
  {
    key: "ndrc_policy_documents",
    hosts: ["www.ndrc.gov.cn", "ndrc.gov.cn"],
    selectors: [".article_con", ".TRS_Editor", ".article-content", "#zoom", ".content"]
  },
  {
    key: "miit_policy_library",
    hosts: ["www.miit.gov.cn", "miit.gov.cn"],
    selectors: [".ccontent", ".TRS_Editor", "#Zoom", ".article-content", ".article"]
  },
  {
    key: "nda_policy_release",
    hosts: ["www.nda.gov.cn", "nda.gov.cn"],
    selectors: [".detail .article", ".detail", ".TRS_Editor", ".article-content", ".article"]
  }
];

const FALLBACK_SELECTORS = ["article", "main", ".content", ".detail", ".article", "body"];

export async function fetchOfficialPolicySource(input, options = {}) {
  const policyId = requiredString(input.policyId, "policyId");
  const sourceUrl = assertApprovedOfficialSourceUrl(
    requiredString(input.sourceUrl, `sourceUrl for ${policyId}`)
  );
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const response = await fetchWithRetry(sourceUrl, {
    timeoutMs,
    retries: nonNegativeInteger(options.retries, 2),
    headers: {
      "user-agent": "Mozilla/5.0 policy-impact-terminal stage7 source verifier",
      accept: "text/html,application/xhtml+xml"
    }
  });
  assertApprovedOfficialSourceUrl(response.url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const decoded = decodeHtmlBuffer(buffer);
  const extracted = extractOfficialPolicyPage(decoded.text, sourceUrl, {
    expectedTitle: input.title,
    sourceKey: input.sourceKey
  });

  const attachmentResults = [];
  for (const attachment of extracted.attachments) {
    const extension = attachmentExtension(attachment.url);
    if (!SUPPORTED_ATTACHMENT_EXTENSIONS.has(extension)) {
      attachmentResults.push({
        ...attachment,
        extension,
        status: "unsupported_for_text_extraction",
        textLength: 0
      });
      continue;
    }
    try {
      attachmentResults.push(await fetchAndExtractAttachment(attachment, {
        timeoutMs,
        retries: nonNegativeInteger(options.retries, 2)
      }));
    } catch (error) {
      attachmentResults.push({
        ...attachment,
        extension,
        status: "extraction_failed",
        textLength: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const sections = [];
  if (extracted.fullText) {
    sections.push({ label: "官方网页正文", text: extracted.fullText });
  }
  for (const [index, attachment] of attachmentResults.entries()) {
    if (attachment.status !== "extracted" || !attachment.text) continue;
    sections.push({
      label: `官方附件${index + 1}${attachment.label ? `：${attachment.label}` : ""}`,
      text: attachment.text
    });
  }
  const fullText = normalizeSourceText(
    sections.map((section) => `【${section.label}】\n${section.text}`).join("\n\n")
  );

  if (fullText.length < MIN_SOURCE_TEXT_LENGTH) {
    throw new Error(
      `Official source ${policyId} extracted ${fullText.length} characters, below ${MIN_SOURCE_TEXT_LENGTH}.`
    );
  }

  const evidenceValidation = validateEvidenceExcerpts(fullText, input.evidenceExcerpts);
  const attachmentReviewRequired = attachmentResults.some((item) => item.status !== "extracted");
  const knownOfficialSource = extracted.sourceKey !== "unknown_official_source";
  const verified =
    knownOfficialSource &&
    !extracted.diagnostics.fallbackBodyUsed &&
    extracted.titleObserved !== false &&
    !attachmentReviewRequired;
  const verificationStatus = verified
    ? "official_source_verified"
    : "official_source_candidate";

  return {
    policyId,
    sourceUrl,
    fullText,
    fetchedAt: new Date().toISOString(),
    officialPublishedAt: input.officialPublishedAt ?? null,
    parserVersion: "official-composite-parser-v1",
    metadata: {
      title: input.title ?? extracted.pageTitle ?? null,
      issuer: input.issuer ?? null,
      sourceName: input.sourceName ?? null,
      sourceKey: extracted.sourceKey,
      sourceHost: extracted.sourceHost,
      sourceOrigin: "official_website_and_attachments",
      exportMethod: "official_url_fetch",
      verificationStatus,
      selectedSelector: extracted.selectedSelector,
      pageTitle: extracted.pageTitle,
      pageTextLength: extracted.fullText.length,
      textLength: fullText.length,
      sourceTextHash: sha256Text(fullText),
      replacementCharacterCount: decoded.replacementCharacterCount,
      decoder: decoded.decoder,
      titleObserved: extracted.titleObserved,
      attachmentReviewRequired,
      attachments: attachmentResults.map(stripAttachmentText),
      evidenceValidation,
      diagnostics: extracted.diagnostics
    }
  };
}

export function assertApprovedOfficialSourceUrl(value) {
  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`Official source URL is invalid: ${value}`);
  }
  if (parsedUrl.protocol !== "https:" || !isApprovedOfficialHost(parsedUrl.hostname)) {
    throw new Error(`Official source URL is outside the approved HTTPS boundary: ${value}`);
  }
  return parsedUrl.href;
}

export function extractOfficialPolicyPage(html, sourceUrl, options = {}) {
  if (typeof html !== "string" || !html.trim()) {
    throw new Error("Official policy HTML is empty.");
  }

  const sourceHost = safeHost(sourceUrl);
  const profile = findSourceProfile(sourceHost, options.sourceKey);
  const $ = cheerio.load(html);
  const attachments = extractAttachments($, sourceUrl);
  $("script, style, noscript, iframe, object, embed, nav, header, footer").remove();

  const selectors = [...new Set([...(profile?.selectors ?? []), ...FALLBACK_SELECTORS])];
  const candidates = [];
  for (const selector of selectors) {
    const element = $(selector).first();
    if (!element.length) continue;
    const fullText = extractStructuredText($, element);
    if (!fullText) continue;
    candidates.push({ selector, fullText, score: scoreCandidate(fullText, selector, profile) });
  }

  candidates.sort((left, right) => right.score - left.score || right.fullText.length - left.fullText.length);
  const selected = candidates[0];
  if (!selected) {
    throw new Error(`No usable policy content container found for ${sourceUrl}.`);
  }

  const pageTitle = normalizeSingleLine($("title").first().text()) || normalizeSingleLine($("h1").first().text());
  const expectedTitle = normalizeSingleLine(options.expectedTitle);
  const normalizedHtmlText = normalizeSingleLine($("body").text());
  const titleObserved = expectedTitle
    ? normalizedHtmlText.includes(expectedTitle) || expectedTitle.includes(pageTitle)
    : null;

  return {
    sourceKey: profile?.key ?? "unknown_official_source",
    sourceHost,
    selectedSelector: selected.selector,
    fullText: selected.fullText,
    pageTitle,
    titleObserved,
    attachments,
    attachmentReviewRequired: attachments.length > 0,
    diagnostics: {
      candidateCount: candidates.length,
      candidateLengths: candidates.slice(0, 5).map((item) => ({
        selector: item.selector,
        length: item.fullText.length,
        score: item.score
      })),
      fallbackBodyUsed: selected.selector === "body"
    }
  };
}

export function decodeHtmlBuffer(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let text = new TextDecoder("utf-8").decode(bytes);
  let replacementCharacterCount = countReplacementCharacters(text);
  let decoder = "utf-8";

  if (replacementCharacterCount > 20) {
    const gb18030Text = new TextDecoder("gb18030").decode(bytes);
    const gb18030ReplacementCount = countReplacementCharacters(gb18030Text);
    if (gb18030ReplacementCount < replacementCharacterCount) {
      text = gb18030Text;
      replacementCharacterCount = gb18030ReplacementCount;
      decoder = "gb18030";
    }
  }

  return { text, decoder, replacementCharacterCount };
}

function extractStructuredText($, sourceElement) {
  const element = sourceElement.clone();
  element.find("script, style, noscript, iframe, object, embed, nav, header, footer, .share, .article_fd, .pages_print").remove();
  element.find("table").each((_, table) => {
    const rows = [];
    $(table).find("tr").each((__, row) => {
      const cells = [];
      $(row).find("th,td").each((___, cell) => {
        const value = normalizeSingleLine($(cell).text());
        if (value) cells.push(value);
      });
      if (cells.length) rows.push(cells.join("\t"));
    });
    $(table).replaceWith(`\n${rows.join("\n")}\n`);
  });
  element.find("br").replaceWith("\n");
  element.find("p,div,li,h1,h2,h3,h4,h5,h6,section,blockquote").each((_, node) => {
    $(node).prepend("\n").append("\n");
  });
  return normalizeSourceText(element.text());
}

function extractAttachments($, sourceUrl) {
  const output = [];
  const add = (rawUrl, label, kind) => {
    if (!rawUrl) return;
    let url;
    try {
      url = new URL(rawUrl, sourceUrl).href;
    } catch {
      return;
    }
    if (!/\.(pdf|docx?|xlsx?|zip|rar)(?:$|[?#])/i.test(url) && !/附件|下载/.test(label ?? "")) return;
    output.push({ label: normalizeSingleLine(label) || null, url, kind });
  };

  $("a[href]").each((_, anchor) => add($(anchor).attr("href"), $(anchor).text(), "link"));
  $("iframe").each((_, frame) => {
    const fileUrl = $(frame).attr("fileurl");
    if (fileUrl) add(fileUrl, "嵌入式附件", "iframe");
    const src = $(frame).attr("src");
    if (!src) return;
    try {
      const resolved = new URL(src, sourceUrl);
      const nestedFile = resolved.searchParams.get("file");
      add(nestedFile || src, "嵌入式附件", "iframe");
    } catch {
      add(src, "嵌入式附件", "iframe");
    }
  });
  $("object[data],embed[src]").each((_, node) => {
    add($(node).attr("data") || $(node).attr("src"), "嵌入式附件", "embedded_object");
  });

  const seen = new Set();
  return output.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function fetchAndExtractAttachment(attachment, options) {
  const parsedUrl = new URL(attachment.url);
  if (parsedUrl.protocol !== "https:" || !isApprovedOfficialHost(parsedUrl.hostname)) {
    throw new Error(`Attachment host is outside the approved official boundary: ${attachment.url}`);
  }
  const response = await fetchWithRetry(attachment.url, {
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    headers: {
      "user-agent": "Mozilla/5.0 policy-impact-terminal stage7 attachment verifier",
      accept: "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*"
    }
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100) throw new Error(`Attachment is unexpectedly small: ${attachment.url}`);

  const extension = attachmentExtension(attachment.url) || extensionFromContentType(response.headers.get("content-type"));
  if (!SUPPORTED_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported official attachment type ${extension || "unknown"}: ${attachment.url}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-source-"));
  const tempFile = path.join(tempDir, `${crypto.randomUUID()}${extension}`);
  try {
    await fs.writeFile(tempFile, bytes);
    const helperPath = path.resolve("scripts/extract-official-attachment-text.py");
    const { stdout, stderr } = await execFileAsync("python", [helperPath, tempFile], {
      cwd: process.cwd(),
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    });
    const result = JSON.parse(stdout);
    if (result.requiresOcr || result.textLength < 40) {
      throw new Error(`Attachment text extraction requires OCR or is too short (${result.textLength}). ${stderr}`);
    }
    return {
      ...attachment,
      extension,
      status: "extracted",
      byteLength: bytes.length,
      contentType: response.headers.get("content-type"),
      contentHash: crypto.createHash("sha256").update(bytes).digest("hex"),
      textLength: result.textLength,
      pageCount: result.pageCount,
      convertedToPdf: result.convertedToPdf,
      render: result.render,
      text: normalizeSourceText(result.text)
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function validateEvidenceExcerpts(fullText, evidenceExcerpts) {
  const excerpts = Array.isArray(evidenceExcerpts)
    ? evidenceExcerpts.map(normalizeSingleLine).filter((item) => item.length >= 8)
    : [];
  const compactSource = compactForMatch(fullText);
  const sourceNgrams = buildNgramSet(compactSource, 4);
  const rows = excerpts.map((excerpt) => {
    const compactExcerpt = compactForMatch(excerpt);
    const exact = compactSource.includes(compactExcerpt);
    const fragments = excerpt
      .split(/[，,。；;：:、]/)
      .map(compactForMatch)
      .filter((item) => item.length >= 6);
    const matchedFragments = fragments.filter((item) => compactSource.includes(item)).length;
    const fragmentRatio = fragments.length > 0 ? matchedFragments / fragments.length : 0;
    const excerptNgrams = [...buildNgramSet(compactExcerpt, 4)];
    const matchedNgrams = excerptNgrams.filter((item) => sourceNgrams.has(item)).length;
    const ngramRecall = excerptNgrams.length > 0 ? matchedNgrams / excerptNgrams.length : 0;
    const compressed = !exact && fragmentRatio >= 0.6 && ngramRecall >= 0.5;
    return {
      excerpt,
      matched: exact || compressed,
      matchType: exact
        ? "exact"
        : compressed
          ? "compressed_excerpt"
          : ngramRecall >= 0.45
            ? "related_but_not_quoted"
            : "not_located",
      fragmentRatio: Number(fragmentRatio.toFixed(3)),
      ngramRecall: Number(ngramRecall.toFixed(3))
    };
  });
  const matched = rows.filter((item) => item.matched).length;
  const ratio = rows.length > 0 ? matched / rows.length : null;
  return {
    excerptCount: rows.length,
    matchedCount: matched,
    exactCount: rows.filter((item) => item.matchType === "exact").length,
    compressedCount: rows.filter((item) => item.matchType === "compressed_excerpt").length,
    relatedButNotQuotedCount: rows.filter((item) => item.matchType === "related_but_not_quoted").length,
    matchRatio: ratio,
    sufficient: rows.length === 0 || ratio >= 0.6,
    rows,
    unmatchedExcerpts: rows.filter((item) => !item.matched).map((item) => item.excerpt)
  };
}

function stripAttachmentText(item) {
  const { text, ...metadata } = item;
  return metadata;
}

function scoreCandidate(fullText, selector, profile) {
  let score = Math.min(fullText.length, 20_000);
  if (profile?.selectors.includes(selector)) score += 10_000;
  if (selector === "body") score -= 15_000;
  if (/版权所有|网站地图|联系我们|主办单位/.test(fullText)) score -= 3_000;
  return score;
}

async function fetchWithRetry(url, options) {
  let lastError;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: options.headers,
        signal: AbortSignal.timeout(options.timeoutMs),
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

function findSourceProfile(host, sourceKey) {
  if (sourceKey) {
    const byKey = SOURCE_PROFILES.find((item) => item.key === sourceKey);
    if (byKey) return byKey;
  }
  return SOURCE_PROFILES.find((item) => item.hosts.includes(host)) ?? null;
}

function isApprovedOfficialHost(hostname) {
  const host = String(hostname).toLowerCase();
  return SOURCE_PROFILES.some((profile) => profile.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)));
}

function safeHost(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function attachmentExtension(value) {
  try {
    return path.extname(new URL(value).pathname).toLowerCase();
  } catch {
    return path.extname(String(value)).toLowerCase();
  }
}

function extensionFromContentType(value) {
  const type = String(value ?? "").toLowerCase();
  if (type.includes("pdf")) return ".pdf";
  if (type.includes("wordprocessingml")) return ".docx";
  if (type.includes("msword")) return ".doc";
  return "";
}

function compactForMatch(value) {
  return normalizeSingleLine(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function buildNgramSet(value, size) {
  const output = new Set();
  if (!value || value.length < size) return output;
  for (let index = 0; index <= value.length - size; index += 1) {
    output.add(value.slice(index, index + size));
  }
  return output;
}

function normalizeSingleLine(value) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim() : "";
}

function requiredString(value, label) {
  const normalized = normalizeSingleLine(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function nonNegativeInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function countReplacementCharacters(value) {
  let count = 0;
  for (const character of value) {
    if (character.charCodeAt(0) === 0xfffd) count += 1;
  }
  return count;
}
