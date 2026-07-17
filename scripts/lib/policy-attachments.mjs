import * as cheerio from "cheerio";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DEFAULT_MAX_ATTACHMENTS = 4;
const DEFAULT_MAX_PDF_ATTACHMENTS = 2;
const DEFAULT_MAX_PDF_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_PDF_PAGES = 300;
const DEFAULT_MAX_TEXT_CHARS = 2_000_000;
const MIN_ATTACHMENT_TEXT_LENGTH = 280;
const WRAPPER_TEXT_LENGTH = 1_200;

export function discoverPolicyAttachments(html, baseUrl, options = {}) {
  if (!html || !baseUrl) return [];
  const maxAttachments = positiveInteger(options.maxAttachments, DEFAULT_MAX_ATTACHMENTS);
  const $ = cheerio.load(html);
  const seen = new Set();
  const attachments = [];

  $("a[href]").each((_, anchor) => {
    if (attachments.length >= maxAttachments) return false;
    const href = $(anchor).attr("href");
    if (!href) return;

    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }
    url.hash = "";

    const title = cleanText($(anchor).text()) || cleanText($(anchor).attr("title")) || url.pathname.split("/").at(-1) || "附件";
    const type = inferAttachmentType(url, title);
    if (!type) return;

    const normalizedUrl = url.href;
    if (seen.has(normalizedUrl)) return;
    seen.add(normalizedUrl);
    attachments.push({
      url: normalizedUrl,
      type,
      title,
      extractionStatus: type === "pdf" ? "not_attempted" : "unsupported"
    });
  });

  return attachments;
}

export function isLikelyWrapperPage(pageText, attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return false;
  const text = normalizePolicyText(pageText);
  if (!text) return true;
  if (text.length < WRAPPER_TEXT_LENGTH) return true;
  return /(?:全文|具体内容|办法|规划|名单|目录|项目计划|申报要求).*?(?:见|详见|请见).*?附件/.test(text.slice(-1_200));
}

export async function hydratePolicyAttachments(input) {
  const pageText = normalizePolicyText(input.pageText);
  const attachments = discoverPolicyAttachments(input.html, input.baseUrl, input);
  const wrapperLikely = isLikelyWrapperPage(pageText, attachments);

  if (attachments.length === 0) {
    return {
      selectedText: pageText,
      attachments,
      wrapperLikely: false,
      attachmentExtractionStatus: "none",
      attachmentEvidenceIncomplete: false,
      extractedAttachmentTextLength: 0,
      errors: []
    };
  }

  if (!wrapperLikely) {
    return {
      selectedText: pageText,
      attachments,
      wrapperLikely: false,
      attachmentExtractionStatus: "not_needed",
      attachmentEvidenceIncomplete: false,
      extractedAttachmentTextLength: 0,
      errors: []
    };
  }

  const fetchBinary = input.fetchBinary;
  if (typeof fetchBinary !== "function") {
    throw new TypeError("hydratePolicyAttachments requires fetchBinary(url, options).");
  }

  const maxPdfAttachments = positiveInteger(input.maxPdfAttachments, DEFAULT_MAX_PDF_ATTACHMENTS);
  const pdfAttachments = attachments.filter((item) => item.type === "pdf").slice(0, maxPdfAttachments);
  const extractedTexts = [];
  const errors = [];

  for (const attachment of pdfAttachments) {
    try {
      const response = await fetchBinary(attachment.url, {
        referer: input.baseUrl,
        accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
        maxBytes: positiveInteger(input.maxPdfBytes, DEFAULT_MAX_PDF_BYTES)
      });
      const text = await extractPdfTextFromBuffer(response.buffer, {
        maxPages: input.maxPdfPages,
        maxTextChars: input.maxTextChars
      });
      if (text.length < MIN_ATTACHMENT_TEXT_LENGTH) {
        throw new Error(`PDF extracted only ${text.length} text characters.`);
      }
      attachment.extractionStatus = "extracted";
      attachment.contentType = response.contentType ?? null;
      attachment.finalUrl = response.finalUrl ?? attachment.url;
      attachment.mirrorFallbackUsed = response.mirrorFallbackUsed === true;
      attachment.bytes = response.buffer.length;
      attachment.textLength = text.length;
      extractedTexts.push(`${attachment.title}\n${text}`);
    } catch (error) {
      const message = getErrorMessage(error);
      attachment.extractionStatus = "failed";
      attachment.error = message;
      errors.push({ url: attachment.url, message });
    }
  }

  const attachmentText = normalizePolicyText(extractedTexts.join("\n\n"));
  const selectedText = shouldPreferAttachmentText(pageText, attachmentText)
    ? attachmentText
    : pageText;
  const hasOfd = attachments.some((item) => item.type === "ofd");
  const attachmentExtractionStatus = attachmentText
    ? "pdf_extracted"
    : pdfAttachments.length > 0
      ? "pdf_failed"
      : hasOfd
        ? "ofd_only"
        : "unsupported";
  const attachmentEvidenceIncomplete = wrapperLikely && !attachmentText;

  return {
    selectedText,
    attachments,
    wrapperLikely,
    attachmentExtractionStatus,
    attachmentEvidenceIncomplete,
    extractedAttachmentTextLength: attachmentText.length,
    errors
  };
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
      const pageText = normalizePolicyText(
        content.items
          .map((item) => typeof item?.str === "string" ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")
          .join("")
      );
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

function shouldPreferAttachmentText(pageText, attachmentText) {
  if (!attachmentText) return false;
  if (!pageText) return true;
  if (pageText.length < WRAPPER_TEXT_LENGTH) return attachmentText.length > pageText.length;
  return attachmentText.length >= pageText.length * 1.25;
}

function inferAttachmentType(url, title) {
  const text = `${url.pathname} ${title}`.toLowerCase();
  if (/\.pdf(?:$|[?#\s])/.test(text) || /\bpdf\b/.test(text)) return "pdf";
  if (/\.ofd(?:$|[?#\s])/.test(text) || /\bofd\b/.test(text)) return "ofd";
  return null;
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
