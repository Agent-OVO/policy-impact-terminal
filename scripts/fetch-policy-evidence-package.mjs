#!/usr/bin/env node
import * as cheerio from "cheerio";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { printJson } from "./lib/json-output.mjs";
import { hydratePolicyAttachments } from "./lib/policy-attachments.mjs";
import { assertUsablePolicyPageHtml } from "./lib/policy-page-validation.mjs";

const MIIT_MIRROR_ORIGINS = [
  "https://www.miit.gov.cn",
  "https://hubca.miit.gov.cn",
  "https://cqca.miit.gov.cn",
  "https://gdca.miit.gov.cn"
];
const args = parseArgs(process.argv.slice(2));
const payload = JSON.parse(await fs.readFile(path.resolve(args.policyJson), "utf8"));
const policy = payload.policy ?? payload;
if (!policy?.id || !policy?.sourceUrl) {
  throw new Error("Policy evidence package requires policy.id and policy.sourceUrl.");
}

const outDir = path.resolve(args.outDir);
const attachmentsDir = path.join(outDir, "attachments");
await fs.mkdir(attachmentsDir, { recursive: true });

const sourceResponse = await fetchOfficialBinary(policy.sourceUrl, {
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  timeoutMs: args.timeoutMs,
  maxBytes: args.maxSourceBytes,
  requirePolicyPageHtml: true
});
const sourceHtml = decodeText(sourceResponse.buffer);
const sourcePageText = extractPolicyTextFromHtml(sourceHtml);
const existingText = normalizePolicyText(policy.fullText);
const pageText = existingText.length >= sourcePageText.length ? existingText : sourcePageText;
const archivedNames = new Set();

const result = await hydratePolicyAttachments({
  html: sourceHtml,
  pageText,
  policyTitle: policy.title,
  baseUrl: sourceResponse.finalUrl || policy.sourceUrl,
  maxAttachments: args.maxAttachments,
  maxAttachmentBytes: args.maxAttachmentBytes,
  maxTotalAttachmentBytes: args.maxTotalAttachmentBytes,
  fetchBinary: (url, options) => fetchOfficialBinary(url, {
    ...options,
    timeoutMs: args.timeoutMs
  }),
  archiveAttachment: async ({ attachment, buffer }) => {
    const name = buildAttachmentFilename(attachment, archivedNames);
    const absolute = path.join(attachmentsDir, name);
    await fs.writeFile(absolute, buffer);
    return path.relative(outDir, absolute).replaceAll("\\", "/");
  }
});

const generatedAt = new Date().toISOString();
const manifest = {
  formatVersion: "policy-evidence-package-v1",
  generatedAt,
  policy: {
    id: policy.id,
    externalId: policy.externalId ?? null,
    title: policy.title ?? null,
    issuer: policy.issuer ?? null,
    publishDate: policy.publishDate ?? null,
    sourceName: policy.sourceName ?? null,
    sourceUrl: policy.sourceUrl
  },
  sourcePage: {
    requestedUrl: policy.sourceUrl,
    fetchedUrl: sourceResponse.finalUrl || policy.sourceUrl,
    contentType: sourceResponse.contentType ?? null,
    bytes: sourceResponse.buffer.length,
    sha256: sha256(sourceResponse.buffer),
    mirrorFallbackUsed: sourceResponse.mirrorFallbackUsed === true,
    extractedPageTextLength: sourcePageText.length,
    providedPolicyTextLength: existingText.length,
    selectedPageTextLength: pageText.length
  },
  evidence: {
    wrapperLikely: result.wrapperLikely,
    attachmentCount: result.attachments.length,
    discoveredAttachmentCount: result.discoveredAttachmentCount,
    attachmentDiscoveryTruncated: result.attachmentDiscoveryTruncated,
    downloadedAttachmentCount: result.downloadedAttachmentCount,
    unextractedAttachmentCount: result.unextractedAttachmentCount,
    attachmentCollectionStatus: result.attachmentCollectionStatus,
    attachmentExtractionStatus: result.attachmentExtractionStatus,
    attachmentEvidenceIncomplete: result.attachmentEvidenceIncomplete,
    attachmentManualReviewRequired: result.attachmentManualReviewRequired,
    extractedAttachmentTextLength: result.extractedAttachmentTextLength,
    combinedEvidenceTextLength: result.selectedText.length
  },
  attachments: result.attachments,
  errors: result.errors
};

await Promise.all([
  fs.writeFile(path.join(outDir, "manual-policy.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8"),
  fs.writeFile(path.join(outDir, "source-page.html"), sourceHtml, "utf8"),
  fs.writeFile(path.join(outDir, "source-page.txt"), `${sourcePageText}\n`, "utf8"),
  fs.writeFile(path.join(outDir, "evidence.txt"), `${result.selectedText}\n`, "utf8"),
  fs.writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
]);

printJson({
  ok: true,
  policyId: policy.id,
  outDir,
  attachmentCount: result.attachments.length,
  discoveredAttachmentCount: result.discoveredAttachmentCount,
  attachmentDiscoveryTruncated: result.attachmentDiscoveryTruncated,
  downloadedAttachmentCount: result.downloadedAttachmentCount,
  unextractedAttachmentCount: result.unextractedAttachmentCount,
  attachmentCollectionStatus: result.attachmentCollectionStatus,
  attachmentExtractionStatus: result.attachmentExtractionStatus,
  attachmentEvidenceIncomplete: result.attachmentEvidenceIncomplete,
  attachmentManualReviewRequired: result.attachmentManualReviewRequired
});

function parseArgs(values) {
  const parsed = {
    policyJson: "",
    outDir: "artifacts/manual-analysis/policy-evidence",
    maxAttachments: 64,
    maxAttachmentBytes: 40 * 1024 * 1024,
    maxTotalAttachmentBytes: 160 * 1024 * 1024,
    maxSourceBytes: 12 * 1024 * 1024,
    timeoutMs: 25_000
  };
  for (const value of values) {
    if (value.startsWith("--policy-json=")) parsed.policyJson = value.slice(14);
    else if (value.startsWith("--out-dir=")) parsed.outDir = value.slice(10);
    else if (value.startsWith("--max-attachments=")) parsed.maxAttachments = positiveInteger(value.slice(18), parsed.maxAttachments);
    else if (value.startsWith("--max-attachment-bytes=")) parsed.maxAttachmentBytes = positiveInteger(value.slice(23), parsed.maxAttachmentBytes);
    else if (value.startsWith("--max-total-attachment-bytes=")) parsed.maxTotalAttachmentBytes = positiveInteger(value.slice(29), parsed.maxTotalAttachmentBytes);
    else if (value.startsWith("--timeout-ms=")) parsed.timeoutMs = positiveInteger(value.slice(13), parsed.timeoutMs);
    else if (value === "--help" || value === "-h") {
      console.log("Usage: node scripts/fetch-policy-evidence-package.mjs --policy-json=<manual-policy.json> --out-dir=<directory>");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${value}`);
  }
  if (!parsed.policyJson) throw new Error("--policy-json is required.");
  return parsed;
}

async function fetchOfficialBinary(url, options = {}) {
  const urls = buildOfficialMirrorUrls(url);
  const errors = [];
  for (let index = 0; index < urls.length; index += 1) {
    const target = urls[index];
    try {
      const response = await fetchBinary(target, {
        ...options,
        referer: rewriteReferer(options.referer, new URL(target).origin)
      });
      if (options.requirePolicyPageHtml === true) {
        assertUsablePolicyPageHtml(response.buffer);
      }
      return {
        ...response,
        mirrorFallbackUsed: index > 0,
        originalUrl: url
      };
    } catch (error) {
      errors.push(`${target}: ${getErrorMessage(error)}`);
    }
  }
  throw new Error(`Official source fetch failed. ${errors.join(" | ")}`);
}

function buildOfficialMirrorUrls(value) {
  const url = new URL(value);
  if (!(url.hostname === "miit.gov.cn" || url.hostname.endsWith(".miit.gov.cn"))) return [url.href];
  return [...new Set(MIIT_MIRROR_ORIGINS.map((origin) => new URL(`${url.pathname}${url.search}`, origin).href))];
}

function rewriteReferer(value, targetOrigin) {
  if (!value) return `${targetOrigin}/`;
  try {
    const referer = new URL(value);
    return new URL(`${referer.pathname}${referer.search}`, targetOrigin).href;
  } catch {
    return `${targetOrigin}/`;
  }
}

async function fetchBinary(url, options = {}) {
  const attempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs || 25_000),
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 policy-impact-terminal evidence collector",
          accept: options.accept || "application/octet-stream,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9",
          ...(options.referer ? { referer: options.referer } : {})
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length"));
      if (options.maxBytes && Number.isFinite(contentLength) && contentLength > options.maxBytes) {
        throw new Error(`Content length ${contentLength} exceeds ${options.maxBytes}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (options.maxBytes && buffer.length > options.maxBytes) throw new Error(`Payload exceeds ${options.maxBytes} bytes`);
      return {
        buffer,
        contentType: response.headers.get("content-type"),
        finalUrl: response.url || url
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
  }
  throw new Error(`fetch failed after ${attempts} attempts: ${getErrorMessage(lastError)}`);
}

function extractPolicyTextFromHtml(html) {
  const $ = cheerio.load(html || "");
  $("script,style,noscript,iframe,nav,header,footer").remove();
  const selectors = [
    "#UCAP-CONTENT", "#Zoom", "#zoom", ".TRS_Editor", ".pages_content",
    ".article-content", ".article_con", ".article", ".content", ".detail", "article", "main"
  ];
  for (const selector of selectors) {
    const text = normalizePolicyText($(selector).first().text());
    if (text.length > 120) return text;
  }
  return normalizePolicyText($("body").text());
}

function buildAttachmentFilename(attachment, used) {
  const source = attachment.filename || attachment.title || "attachment";
  const extension = path.extname(source) || extensionForType(attachment.type);
  const base = path.basename(source, path.extname(source))
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "attachment";
  const suffix = String(attachment.sha256 || sha256(Buffer.from(attachment.url))).slice(0, 10);
  let name = `${base}-${suffix}${extension}`;
  let index = 2;
  while (used.has(name.toLowerCase())) name = `${base}-${suffix}-${index++}${extension}`;
  used.add(name.toLowerCase());
  return name;
}

function extensionForType(type) {
  const normalized = String(type || "unknown").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized && normalized !== "unknown" ? `.${normalized}` : ".bin";
}

function decodeText(buffer) {
  let text = new TextDecoder("utf-8").decode(buffer);
  const replacements = [...text].filter((char) => char.charCodeAt(0) === 0xfffd).length;
  if (replacements > Math.max(20, text.length * 0.01)) {
    try { text = new TextDecoder("gb18030").decode(buffer); } catch { /* retain UTF-8 */ }
  }
  return text;
}

function normalizePolicyText(value) {
  return typeof value === "string"
    ? value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\r\n?/g, "\n").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
    : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
