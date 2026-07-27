import * as cheerio from "cheerio";
import crypto from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DEFAULT_MAX_ATTACHMENTS = 32;
const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES = 80 * 1024 * 1024;
const DEFAULT_MAX_PDF_PAGES = 300;
const DEFAULT_MAX_TEXT_CHARS = 2_000_000;
const DEFAULT_MAX_ZIP_ENTRIES = 1_000;
const DEFAULT_MAX_ZIP_ENTRY_BYTES = 40 * 1024 * 1024;
const MIN_ATTACHMENT_TEXT_LENGTH = 8;
const WRAPPER_TEXT_LENGTH = 1_200;
const ATTACHMENT_TEXT_PATTERN = /附件|下载|附表|附录|正文(?:文件)?|全文(?:文件)?|名单(?:文件)?|目录(?:文件)?|清单(?:文件)?|表格(?:文件)?|材料(?:文件)?/i;
const ATTACHMENT_DECLARATION_PATTERN = /(?:附件\s*[:：]?\s*(?:\d+[.、．)]?\s*)?.{0,180}\.(?:pdf|ofd|docx?|xlsx?|pptx?|csv|txt|json|xml|zip)|详见附件|请见附件|附件下载|附件如下)/i;
const SHORT_ISSUANCE_WRAPPER_PATTERN = /(?:现将|现予).{0,160}(?:印发|发布|公布).{0,120}(?:请|执行|落实|遵照|给你们)/s;
const TITLE_ISSUANCE_PATTERN = /关于(?:印发|发布|公布|转发)《[^》]{4,120}》/;
const INTERPRETATION_LINK_PATTERN = /政策解读|一图读懂|图解|答记者问|新闻发布|访谈|\/jd\/|\/zctj\/|\/jiedu\//i;
const TEXT_TYPES = new Set(["pdf", "ofd", "docx", "xlsx", "pptx", "txt", "csv", "json", "xml", "html", "zip"]);
const FILE_ATTACHMENT_TYPES = new Set([
  "pdf", "ofd", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "csv", "txt", "json", "xml", "zip", "jpg", "png", "tiff", "bmp", "gif", "webp"
]);
const EXTENSION_TYPES = new Map([
  ["pdf", "pdf"], ["ofd", "ofd"], ["doc", "doc"], ["docx", "docx"],
  ["xls", "xls"], ["xlsx", "xlsx"], ["ppt", "ppt"], ["pptx", "pptx"],
  ["csv", "csv"], ["txt", "txt"], ["json", "json"], ["xml", "xml"],
  ["html", "html"], ["htm", "html"], ["zip", "zip"],
  ["jpg", "jpg"], ["jpeg", "jpg"], ["png", "png"], ["tif", "tiff"],
  ["tiff", "tiff"], ["bmp", "bmp"], ["gif", "gif"], ["webp", "webp"]
]);

export function discoverPolicyAttachments(html, baseUrl, options = {}) {
  if (!html || !baseUrl) return [];
  const maxAttachments = positiveInteger(options.maxAttachments, DEFAULT_MAX_ATTACHMENTS);
  const $ = cheerio.load(html);
  const seen = new Set();
  const attachments = [];

  const candidates = [];
  $("a[href]").each((_, element) => candidates.push({
    href: $(element).attr("href"),
    title: cleanText($(element).text()) || cleanText($(element).attr("title")),
    sourceElement: "a"
  }));
  $("iframe[src], embed[src]").each((_, element) => candidates.push({
    href: $(element).attr("src"),
    title: cleanText($(element).attr("title")) || cleanText($(element).attr("name")) || "嵌入附件",
    sourceElement: element.tagName
  }));
  $("object[data]").each((_, element) => candidates.push({
    href: $(element).attr("data"),
    title: cleanText($(element).attr("title")) || "嵌入附件",
    sourceElement: "object"
  }));
  $("[data-url], [data-href], [data-file], [fileurl]").each((_, element) => candidates.push({
    href: $(element).attr("data-url") || $(element).attr("data-href") || $(element).attr("data-file") || $(element).attr("fileurl"),
    title: cleanText($(element).text()) || cleanText($(element).attr("title")) || "数据附件",
    sourceElement: "data-attribute"
  }));

  for (const candidate of candidates) {
    const href = candidate.href;
    if (!href || /^(?:javascript:|mailto:|tel:|#)/i.test(href.trim())) continue;

    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    url.hash = "";
    const filename = decodeURIComponent(url.pathname.split("/").at(-1) || "");
    const title = candidate.title || filename || "附件";
    const type = inferAttachmentType(url, title);
    const interpretationLink = INTERPRETATION_LINK_PATTERN.test(`${title} ${url.pathname}`);
    if (interpretationLink && !FILE_ATTACHMENT_TYPES.has(type)) continue;
    const explicitAttachment = ATTACHMENT_TEXT_PATTERN.test(`${title} ${url.pathname} ${url.search}`);
    const embeddedElement = ["iframe", "embed", "object"].includes(candidate.sourceElement);
    const attachmentLike = FILE_ATTACHMENT_TYPES.has(type) || embeddedElement || explicitAttachment;
    if (!attachmentLike) continue;

    const normalizedUrl = url.href;
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    attachments.push({
      url: normalizedUrl,
      type: type || "unknown",
      title,
      filename: filename || null,
      sourceElement: candidate.sourceElement,
      downloadStatus: "not_attempted",
      extractionStatus: "not_attempted"
    });
  }

  const limited = attachments.slice(0, maxAttachments);
  limited.totalDiscovered = attachments.length;
  limited.discoveryTruncated = attachments.length > maxAttachments;
  return limited;
}

export function isLikelyWrapperPage(pageText, attachments = [], policyTitle = "") {
  const text = normalizePolicyText(pageText);
  const title = cleanText(policyTitle);
  const hasDiscoveredAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!text) return hasDiscoveredAttachments || TITLE_ISSUANCE_PATTERN.test(title);

  const declarationScope = text.slice(-2_000);
  const declaresAttachments = ATTACHMENT_DECLARATION_PATTERN.test(declarationScope);
  const shortIssuanceNotice = text.length < WRAPPER_TEXT_LENGTH && (
    SHORT_ISSUANCE_WRAPPER_PATTERN.test(text) || TITLE_ISSUANCE_PATTERN.test(title)
  );
  if (declaresAttachments || shortIssuanceNotice) return true;
  if (hasDiscoveredAttachments && text.length < WRAPPER_TEXT_LENGTH) return true;
  return /(?:全文|具体内容|办法|规划|名单|目录|项目计划|申报要求).*?(?:见|详见|请见).*?附件/.test(text.slice(-1_500));
}

export async function hydratePolicyAttachments(input) {
  const pageText = normalizePolicyText(input.pageText);
  const attachments = discoverPolicyAttachments(input.html, input.baseUrl, input);
  const discoveredAttachmentCount = Number(attachments.totalDiscovered ?? attachments.length);
  const attachmentDiscoveryTruncated = attachments.discoveryTruncated === true;
  const wrapperLikely = isLikelyWrapperPage(pageText, attachments, input.policyTitle);

  if (attachments.length === 0) {
    return emptyResult(pageText, wrapperLikely);
  }

  if (input.fetchAttachments === false) {
    return {
      selectedText: pageText,
      attachments,
      wrapperLikely,
      attachmentCollectionStatus: "not_attempted",
      attachmentExtractionStatus: "not_attempted",
      attachmentEvidenceIncomplete: true,
      attachmentManualReviewRequired: true,
      discoveredAttachmentCount,
      attachmentDiscoveryTruncated,
      extractedAttachmentTextLength: 0,
      downloadedAttachmentCount: 0,
      unextractedAttachmentCount: attachments.length,
      errors: []
    };
  }

  if (typeof input.fetchBinary !== "function") {
    throw new TypeError("hydratePolicyAttachments requires fetchBinary(url, options).");
  }

  const maxBytes = positiveInteger(input.maxAttachmentBytes, DEFAULT_MAX_ATTACHMENT_BYTES);
  const maxTotalBytes = positiveInteger(input.maxTotalAttachmentBytes, DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES);
  const extracted = [];
  const errors = [];
  let totalBytes = 0;

  for (const attachment of attachments) {
    if (totalBytes >= maxTotalBytes) {
      attachment.downloadStatus = "skipped_limit";
      attachment.extractionStatus = "not_attempted";
      attachment.error = `Total attachment budget ${maxTotalBytes} bytes exhausted.`;
      errors.push({ url: attachment.url, message: attachment.error });
      continue;
    }

    try {
      const response = await input.fetchBinary(attachment.url, {
        referer: input.baseUrl,
        accept: acceptForType(attachment.type),
        maxBytes: Math.min(maxBytes, maxTotalBytes - totalBytes)
      });
      const buffer = Buffer.isBuffer(response.buffer) ? response.buffer : Buffer.from(response.buffer ?? []);
      const expectedType = attachment.type;
      if (FILE_ATTACHMENT_TYPES.has(expectedType) && looksLikeHtmlPayload(buffer, response.contentType)) {
        throw new Error(`Attachment returned an HTML/error page instead of ${expectedType}: ${attachment.url}`);
      }
      totalBytes += buffer.length;
      attachment.type = detectAttachmentType(buffer, response.contentType, response.finalUrl || attachment.url, attachment.title, expectedType);
      attachment.downloadStatus = "downloaded";
      attachment.contentType = response.contentType ?? null;
      attachment.finalUrl = response.finalUrl ?? attachment.url;
      attachment.mirrorFallbackUsed = response.mirrorFallbackUsed === true;
      attachment.bytes = buffer.length;
      attachment.sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

      if (typeof input.archiveAttachment === "function") {
        const archived = await input.archiveAttachment({ attachment, buffer });
        if (archived) attachment.archivePath = archived;
      }

      let text = "";
      try {
        text = await extractAttachmentTextFromBuffer(buffer, attachment.type, {
          maxPdfPages: input.maxPdfPages,
          maxTextChars: input.maxTextChars,
          maxZipEntries: input.maxZipEntries,
          maxZipEntryBytes: input.maxZipEntryBytes
        });
      } catch (error) {
        attachment.extractionStatus = "failed";
        attachment.error = getErrorMessage(error);
        errors.push({ url: attachment.url, message: attachment.error });
        continue;
      }

      if (text.length >= MIN_ATTACHMENT_TEXT_LENGTH) {
        attachment.extractionStatus = "extracted";
        attachment.textLength = text.length;
        extracted.push({ attachment, text });
      } else if (TEXT_TYPES.has(attachment.type)) {
        attachment.extractionStatus = "no_text";
        attachment.textLength = text.length;
      } else {
        attachment.extractionStatus = "downloaded_unextracted";
        attachment.textLength = 0;
      }
    } catch (error) {
      attachment.downloadStatus = "failed";
      attachment.extractionStatus = "failed";
      attachment.error = getErrorMessage(error);
      errors.push({ url: attachment.url, message: attachment.error });
    }
  }

  const selectedText = composePolicyEvidenceText(pageText, extracted);
  const extractedAttachmentTextLength = extracted.reduce((sum, item) => sum + item.text.length, 0);
  const downloadedAttachmentCount = attachments.filter((item) => item.downloadStatus === "downloaded").length;
  const failedAttachmentCount = attachments.filter((item) => item.downloadStatus !== "downloaded").length;
  const unextractedAttachmentCount = attachments.filter((item) => item.extractionStatus !== "extracted").length;
  const attachmentCollectionStatus = failedAttachmentCount === 0
    ? "complete"
    : downloadedAttachmentCount > 0
      ? "partial"
      : "failed";
  const attachmentExtractionStatus = extracted.length === attachments.length
    ? "all_extracted"
    : extracted.length > 0
      ? "partial"
      : downloadedAttachmentCount > 0
        ? "downloaded_unextracted"
        : "failed";
  const attachmentEvidenceIncomplete = attachmentDiscoveryTruncated || failedAttachmentCount > 0;
  const attachmentManualReviewRequired = attachmentDiscoveryTruncated || unextractedAttachmentCount > 0;

  return {
    selectedText,
    attachments,
    wrapperLikely,
    attachmentCollectionStatus,
    attachmentExtractionStatus,
    attachmentEvidenceIncomplete,
    attachmentManualReviewRequired,
    discoveredAttachmentCount,
    attachmentDiscoveryTruncated,
    extractedAttachmentTextLength,
    downloadedAttachmentCount,
    unextractedAttachmentCount,
    errors
  };
}

export async function extractAttachmentTextFromBuffer(value, type, options = {}) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  const maxTextChars = positiveInteger(options.maxTextChars, DEFAULT_MAX_TEXT_CHARS);
  switch (type) {
    case "pdf":
      return extractPdfTextFromBuffer(buffer, {
        maxPages: options.maxPdfPages,
        maxTextChars
      });
    case "docx":
      return extractZipXmlText(buffer, [/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i], options).slice(0, maxTextChars);
    case "xlsx":
      return extractZipXmlText(buffer, [/^xl\/(?:sharedStrings\.xml|worksheets\/sheet\d+\.xml|workbook\.xml)$/i], options).slice(0, maxTextChars);
    case "pptx":
      return extractZipXmlText(buffer, [/^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i], options).slice(0, maxTextChars);
    case "ofd":
      return extractZipXmlText(buffer, [/\.xml$/i], options).slice(0, maxTextChars);
    case "zip":
      return extractZipTextFiles(buffer, options).slice(0, maxTextChars);
    case "xml":
    case "html":
      return extractXmlText(decodeTextBuffer(buffer)).slice(0, maxTextChars);
    case "txt":
    case "csv":
    case "json":
      return normalizePolicyText(decodeTextBuffer(buffer)).slice(0, maxTextChars);
    default:
      return "";
  }
}

export async function extractPdfTextFromBuffer(value, options = {}) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (buffer.length < 8 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Attachment is not a valid PDF payload.");
  }

  const maxPages = positiveInteger(options.maxPages, DEFAULT_MAX_PDF_PAGES);
  const maxTextChars = positiveInteger(options.maxTextChars, DEFAULT_MAX_TEXT_CHARS);
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true
  });

  try {
    const document = await loadingTask.promise;
    const pages = Math.min(document.numPages, maxPages);
    const chunks = [];
    let textLength = 0;
    for (let pageNumber = 1; pageNumber <= pages && textLength < maxTextChars; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = normalizePolicyText(content.items
        .map((item) => typeof item?.str === "string" ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")
        .join(""));
      if (pageText) {
        chunks.push(pageText);
        textLength += pageText.length;
      }
      page.cleanup();
    }
    return normalizePolicyText(chunks.join("\n\n")).slice(0, maxTextChars);
  } finally {
    await loadingTask.destroy();
  }
}

function composePolicyEvidenceText(pageText, extracted) {
  const chunks = [];
  if (pageText) chunks.push(pageText);
  const normalizedSeen = pageText ? [compactForComparison(pageText)] : [];
  const logicalTitles = new Set();
  for (const item of extracted) {
    const compact = compactForComparison(item.text);
    const logicalTitle = normalizeLogicalAttachmentTitle(item.attachment.title);
    const duplicateRepresentation = logicalTitle && logicalTitles.has(logicalTitle);
    const duplicateText = normalizedSeen.some((existing) => isNearDuplicate(existing, compact));
    const duplicate = duplicateRepresentation || duplicateText;
    item.attachment.duplicateRepresentation = duplicateRepresentation;
    item.attachment.includedInSelectedText = !duplicate;
    if (logicalTitle) logicalTitles.add(logicalTitle);
    if (duplicate) continue;
    normalizedSeen.push(compact);
    chunks.push(`【附件：${item.attachment.title}】\n${item.text}`);
  }
  return normalizePolicyText(chunks.join("\n\n"));
}

function extractZipXmlText(buffer, patterns, options) {
  const entries = parseZipEntries(buffer, options);
  const texts = [];
  for (const entry of entries) {
    if (!patterns.some((pattern) => pattern.test(entry.name))) continue;
    texts.push(extractXmlText(decodeTextBuffer(entry.buffer)));
  }
  return normalizePolicyText(texts.join("\n\n"));
}

function extractZipTextFiles(buffer, options) {
  const entries = parseZipEntries(buffer, options);
  const texts = [];
  for (const entry of entries) {
    if (/\.(?:txt|csv|json|xml|html?|md)$/i.test(entry.name)) {
      const decoded = decodeTextBuffer(entry.buffer);
      texts.push(/\.(?:xml|html?)$/i.test(entry.name) ? extractXmlText(decoded) : decoded);
    }
  }
  return normalizePolicyText(texts.join("\n\n"));
}

function parseZipEntries(buffer, options = {}) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("Attachment is not a supported ZIP/OOXML/OFD payload.");
  }
  const maxEntries = positiveInteger(options.maxZipEntries, DEFAULT_MAX_ZIP_ENTRIES);
  const maxEntryBytes = positiveInteger(options.maxZipEntryBytes, DEFAULT_MAX_ZIP_ENTRY_BYTES);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("ZIP central directory was not found.");
  const declaredEntries = Math.min(buffer.readUInt16LE(eocdOffset + 10), maxEntries);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];

  for (let index = 0; index < declaredEntries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/") || uncompressedSize > maxEntryBytes) continue;
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let payload;
    if (method === 0) payload = Buffer.from(compressed);
    else if (method === 8) payload = inflateRawSync(compressed, { maxOutputLength: maxEntryBytes });
    else continue;
    entries.push({ name, buffer: payload });
  }
  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function extractXmlText(value) {
  return normalizePolicyText(decodeXmlEntities(String(value)
    .replace(/<w:tab\s*\/?\s*>/gi, "\t")
    .replace(/<w:br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:w:p|a:p|text:p|ofd:TextObject)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")));
}

function decodeTextBuffer(buffer) {
  let text = new TextDecoder("utf-8").decode(buffer);
  const replacementCount = [...text].filter((char) => char.charCodeAt(0) === 0xfffd).length;
  if (replacementCount > Math.max(5, text.length * 0.01)) {
    try { text = new TextDecoder("gb18030").decode(buffer); } catch { /* keep UTF-8 */ }
  }
  return text;
}

function inferAttachmentType(url, title) {
  const text = `${url.pathname} ${title}`.toLowerCase();
  const match = text.match(/\.([a-z0-9]{2,5})(?:$|[?#\s）)】》])/i);
  return match ? EXTENSION_TYPES.get(match[1].toLowerCase()) || null : null;
}

function detectAttachmentType(buffer, contentType, finalUrl, title, fallbackType) {
  const inferred = inferAttachmentType(new URL(finalUrl || "https://invalid.local/"), title);
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return ["doc", "xls", "ppt"].includes(inferred) ? inferred : ["doc", "xls", "ppt"].includes(fallbackType) ? fallbackType : "doc";
  }
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    return inferred === "ofd" || fallbackType === "ofd" ? "ofd" : inferred || fallbackType || "zip";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("hex") === "ffd8ff") return "jpg";

  const type = String(contentType || "").toLowerCase();
  if (type.includes("pdf")) return "pdf";
  if (type.includes("officedocument.wordprocessingml")) return "docx";
  if (type.includes("officedocument.spreadsheetml")) return "xlsx";
  if (type.includes("officedocument.presentationml")) return "pptx";
  if (type.includes("msword")) return "doc";
  if (type.includes("ms-excel")) return "xls";
  if (type.includes("ms-powerpoint")) return "ppt";
  if (type.includes("application/ofd")) return "ofd";
  if (type.includes("image/jpeg")) return "jpg";
  if (type.includes("image/png")) return "png";
  if (type.includes("image/tiff")) return "tiff";
  if (type.includes("image/bmp")) return "bmp";
  if (type.includes("image/gif")) return "gif";
  if (type.includes("image/webp")) return "webp";
  if (type.includes("text/csv")) return "csv";
  if (type.includes("text/plain")) return "txt";
  if (type.includes("json")) return "json";
  if (type.includes("xml")) return "xml";
  if (type.includes("html")) return "html";
  return inferred || fallbackType || "unknown";
}

function acceptForType(type) {
  if (type === "pdf") return "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1";
  return "application/octet-stream,application/pdf,application/zip,text/plain,text/csv,*/*;q=0.1";
}

function looksLikeHtmlPayload(buffer, contentType) {
  if (hasKnownBinaryMagic(buffer)) return false;
  const preview = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").trim().toLowerCase();
  const htmlMarkup = /^(?:<!doctype\s+html|<html\b|<body\b|<head\b)/i.test(preview);
  const knownError = /信息模板页面配置实体不能为空|access denied|request blocked|forbidden/.test(preview);
  return htmlMarkup || knownError || (String(contentType || "").toLowerCase().includes("html") && /<[^>]+>/.test(preview));
}

function hasKnownBinaryMagic(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return true;
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) return true;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return true;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("hex") === "ffd8ff") return true;
  return false;
}

function emptyResult(pageText, wrapperLikely = false) {
  const missingAttachmentMessage = "Policy page appears attachment-dependent, but no attachment links were discovered.";
  return {
    selectedText: pageText,
    attachments: [],
    wrapperLikely,
    attachmentCollectionStatus: wrapperLikely ? "missing" : "none",
    attachmentExtractionStatus: "none",
    attachmentEvidenceIncomplete: wrapperLikely,
    attachmentManualReviewRequired: false,
    discoveredAttachmentCount: 0,
    attachmentDiscoveryTruncated: false,
    extractedAttachmentTextLength: 0,
    downloadedAttachmentCount: 0,
    unextractedAttachmentCount: 0,
    errors: wrapperLikely ? [{ url: null, message: missingAttachmentMessage }] : []
  };
}

function isNearDuplicate(a, b) {
  if (!a || !b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length < 80) return a === b;
  return longer.includes(shorter) || shorter.slice(0, 240) === longer.slice(0, 240) && shorter.slice(-240) === longer.slice(-240);
}

function compactForComparison(value) {
  return normalizePolicyText(value).replace(/\s+/g, "");
}

function normalizeLogicalAttachmentTitle(value) {
  return cleanText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\.(?:pdf|ofd|docx?|xlsx?|pptx?|csv|txt|json|xml|html?|zip)$/i, "")
    .replace(/[《》“”"'【】()（）\[\],，.。;；:：\-_—\s]/g, "");
}

function decodeXmlEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizePolicyText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
