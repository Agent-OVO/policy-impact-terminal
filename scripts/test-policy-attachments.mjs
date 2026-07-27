#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  discoverPolicyAttachments,
  extractAttachmentTextFromBuffer,
  extractPdfTextFromBuffer,
  hydratePolicyAttachments,
  isLikelyWrapperPage
} from "./lib/policy-attachments.mjs";

const discoveryHtml = `
  <html><body>
    <a href="./policy.pdf">政策正文PDF</a>
    <a href="./list.xlsx">项目名单XLSX</a>
    <a href="./old.doc">历史附件DOC</a>
    <iframe src="./embedded.ofd" title="嵌入OFD"></iframe>
    <a href="./jd/answer.html">《测试政策》答记者问</a>
    <a href="./zctj/graphic.html">一图读懂 | 《测试政策》</a>
  </body></html>
`;
const discovered = discoverPolicyAttachments(discoveryHtml, "https://example.gov.cn/policy/page.html");
assert.deepEqual(discovered.map((item) => item.type), ["pdf", "xlsx", "doc", "ofd"]);
assert.ok(discovered.every((item) => !/答记者问|一图读懂/.test(item.title)));
assert.equal(discovered[1].url, "https://example.gov.cn/policy/list.xlsx");
assert.equal(discoverPolicyAttachments(`<div data-url="./navigation.html">普通导航</div>`, "https://example.gov.cn/page.html").length, 0);
assert.deepEqual(
  discoverPolicyAttachments(`<div data-url="./table.xlsx">附件表格</div>`, "https://example.gov.cn/page.html").map((item) => item.type),
  ["xlsx"]
);
assert.deepEqual(
  discoverPolicyAttachments(`<a href="./scan.png">扫描附件.png</a>`, "https://example.gov.cn/page.html").map((item) => item.type),
  ["png"]
);
assert.equal(isLikelyWrapperPage("现予公布，具体内容详见附件。", discovered), true);

const pdfBuffer = createMinimalPdf("Policy attachment full text for deterministic extraction test. ".repeat(8));
const xlsxBuffer = createStoredZip({
  "xl/sharedStrings.xml": `<?xml version="1.0"?><sst><si><t>重点项目名单</t></si><si><t>项目甲</t></si><si><t>项目乙</t></si></sst>`,
  "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>`
});
const ofdBuffer = createStoredZip({
  "OFD.xml": `<?xml version="1.0"?><ofd:OFD xmlns:ofd="http://www.ofdspec.org/2016"><ofd:DocBody><ofd:DocRoot>正式OFD附件内容</ofd:DocRoot></ofd:DocBody></ofd:OFD>`
});

const extractedPdf = await extractPdfTextFromBuffer(pdfBuffer);
assert.match(extractedPdf, /Policy attachment full text/);
const extractedXlsx = await extractAttachmentTextFromBuffer(xlsxBuffer, "xlsx");
assert.match(extractedXlsx, /重点项目名单/);
assert.match(extractedXlsx, /项目甲/);
const extractedOfd = await extractAttachmentTextFromBuffer(ofdBuffer, "ofd");
assert.match(extractedOfd, /正式OFD附件内容/);

const longPageText = "这是完整政策正文，包含执行主体、适用范围、工作机制和监督要求。".repeat(80);
const longPageHtml = `
  <html><body>
    <div class="TRS_Editor">${longPageText}</div>
    <a href="./policy.pdf">政策说明.pdf</a>
    <a href="./list.xlsx">重点项目名单.xlsx</a>
  </body></html>
`;
const fetched = [];
const archived = [];
const hydrated = await hydratePolicyAttachments({
  html: longPageHtml,
  pageText: longPageText,
  baseUrl: "https://example.gov.cn/policy/page.html",
  fetchBinary: async (url) => {
    fetched.push(url);
    if (url.endsWith(".pdf")) return { buffer: pdfBuffer, contentType: "application/pdf" };
    if (url.endsWith(".xlsx")) return { buffer: xlsxBuffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    throw new Error(`unexpected attachment ${url}`);
  },
  archiveAttachment: async ({ attachment, buffer }) => {
    archived.push({ title: attachment.title, bytes: buffer.length });
    return `attachments/${attachment.title}`;
  }
});
assert.equal(fetched.length, 2, "attachments must be fetched even when the page body is long and complete");
assert.equal(archived.length, 2);
assert.equal(hydrated.attachmentCollectionStatus, "complete");
assert.equal(hydrated.attachmentExtractionStatus, "all_extracted");
assert.equal(hydrated.attachmentEvidenceIncomplete, false);
assert.equal(hydrated.attachmentManualReviewRequired, false);
assert.equal(hydrated.downloadedAttachmentCount, 2);
assert.match(hydrated.selectedText, /Policy attachment full text/);
assert.match(hydrated.selectedText, /重点项目名单/);
assert.ok(hydrated.attachments.every((item) => item.sha256?.length === 64));
assert.ok(hydrated.attachments.every((item) => item.archivePath?.startsWith("attachments/")));

const mislabeledPdf = await hydratePolicyAttachments({
  html: `<div>正文详见附件。</div><a href="./legacy.doc">实际为PDF的附件.doc</a>`,
  pageText: "正文详见附件。",
  baseUrl: "https://example.gov.cn/policy/page.html",
  fetchBinary: async () => ({ buffer: pdfBuffer, contentType: "application/pdf" })
});
assert.equal(mislabeledPdf.attachments[0].type, "pdf");
assert.equal(mislabeledPdf.attachments[0].extractionStatus, "extracted");

const legacyDoc = await hydratePolicyAttachments({
  html: `<div>现予公布，具体内容详见附件。</div><a href="./legacy.doc">完整办法.doc</a>`,
  pageText: "现予公布，具体内容详见附件。",
  baseUrl: "https://example.gov.cn/policy/page.html",
  fetchBinary: async () => ({
    buffer: Buffer.from("legacy-binary-doc-payload"),
    contentType: "application/msword"
  })
});
assert.equal(legacyDoc.attachments[0].downloadStatus, "downloaded");
assert.equal(legacyDoc.attachments[0].extractionStatus, "downloaded_unextracted");
assert.equal(legacyDoc.attachmentEvidenceIncomplete, true);
assert.equal(legacyDoc.attachmentManualReviewRequired, true);

const imageHydrated = await hydratePolicyAttachments({
  html: `<div>扫描文件见附件。</div><a href="./scan.png">扫描附件.png</a>`,
  pageText: "扫描文件见附件。",
  baseUrl: "https://example.gov.cn/policy/page.html",
  fetchBinary: async () => ({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" })
});
assert.equal(imageHydrated.attachments[0].type, "png");
assert.equal(imageHydrated.attachments[0].downloadStatus, "downloaded");
assert.equal(imageHydrated.attachments[0].extractionStatus, "downloaded_unextracted");
assert.equal(imageHydrated.attachmentManualReviewRequired, true);

const ofdHydrated = await hydratePolicyAttachments({
  html: `<div>现予公布，具体内容详见附件。</div><a href="./policy.ofd">完整办法.ofd</a>`,
  pageText: "现予公布，具体内容详见附件。",
  baseUrl: "https://example.gov.cn/policy/page.html",
  fetchBinary: async () => ({ buffer: ofdBuffer, contentType: "application/ofd" })
});
assert.equal(ofdHydrated.attachmentCollectionStatus, "complete");
assert.equal(ofdHydrated.attachmentExtractionStatus, "all_extracted");
assert.equal(ofdHydrated.attachmentEvidenceIncomplete, false);
assert.match(ofdHydrated.selectedText, /正式OFD附件内容/);

const sameDocumentFormats = await hydratePolicyAttachments({
  html: `<div>${extractedPdf}</div><a href="./policy.pdf">《同一政策》.pdf</a><a href="./policy.ofd">《同一政策》.ofd</a>`,
  pageText: extractedPdf,
  baseUrl: "https://example.gov.cn/policy/page.html",
  fetchBinary: async (url) => url.endsWith(".pdf")
    ? { buffer: pdfBuffer, contentType: "application/pdf" }
    : { buffer: ofdBuffer, contentType: "application/ofd" }
});
assert.equal(sameDocumentFormats.downloadedAttachmentCount, 2);
assert.equal(sameDocumentFormats.attachments[0].includedInSelectedText, false);
assert.equal(sameDocumentFormats.attachments[1].duplicateRepresentation, true);
assert.equal(sameDocumentFormats.attachments[1].includedInSelectedText, false);
assert.equal(sameDocumentFormats.selectedText, extractedPdf);

console.log("[policy:attachment-test] all-format discovery, long-page attachment collection, original-file archiving, PDF/OOXML/OFD extraction, interpretation exclusion, and multi-format text deduplication passed");

function createMinimalPdf(text) {
  const lines = text.match(/.{1,70}/g) ?? [text];
  const commands = lines.map((line, index) => {
    const escaped = line.replace(/([\\()])/g, "\\$1");
    return `${index === 0 ? "" : "0 -16 Td\n"}(${escaped}) Tj`;
  }).join("\n");
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n${commands}\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function createStoredZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(value, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const localBuffer = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localBuffer.length, 16);
  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
