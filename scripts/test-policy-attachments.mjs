#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  discoverPolicyAttachments,
  extractPdfTextFromBuffer,
  hydratePolicyAttachments,
  isLikelyWrapperPage
} from "./lib/policy-attachments.mjs";

const html = `
  <html><body>
    <div class="TRS_Editor">现予公布，具体内容详见附件。</div>
    <a href="./policy.pdf">《测试政策完整条文》PDF</a>
    <a href="./policy.ofd">《测试政策完整条文》OFD</a>
  </body></html>
`;
const attachments = discoverPolicyAttachments(html, "https://example.gov.cn/policy/page.html");
assert.deepEqual(attachments.map((item) => item.type), ["pdf", "ofd"]);
assert.equal(attachments[0].url, "https://example.gov.cn/policy/policy.pdf");
assert.equal(isLikelyWrapperPage("现予公布，具体内容详见附件。", attachments), true);

const pdfBuffer = createMinimalPdf("Policy attachment full text for deterministic extraction test. ".repeat(8));
const extracted = await extractPdfTextFromBuffer(pdfBuffer);
assert.match(extracted, /Policy attachment full text/);

const hydrated = await hydratePolicyAttachments({
  html,
  pageText: "现予公布，具体内容详见附件。",
  baseUrl: "https://example.gov.cn/policy/page.html",
  fetchBinary: async (url) => {
    if (!url.endsWith(".pdf")) throw new Error("unexpected attachment");
    return { buffer: pdfBuffer, contentType: "application/pdf" };
  }
});
assert.equal(hydrated.attachmentExtractionStatus, "pdf_extracted");
assert.equal(hydrated.attachmentEvidenceIncomplete, false);
assert.match(hydrated.selectedText, /Policy attachment full text/);
assert.equal(hydrated.attachments.find((item) => item.type === "pdf")?.extractionStatus, "extracted");

const ofdOnly = await hydratePolicyAttachments({
  html: `<a href="./policy.ofd">附件OFD</a>`,
  pageText: "现予公布，具体内容详见附件。",
  baseUrl: "https://example.gov.cn/policy/page.html",
  fetchBinary: async () => { throw new Error("should not fetch OFD"); }
});
assert.equal(ofdOnly.attachmentExtractionStatus, "ofd_only");
assert.equal(ofdOnly.attachmentEvidenceIncomplete, true);

console.log("[policy:attachment-test] PDF extraction, OFD detection, wrapper gating, and attachment metadata passed");

function createMinimalPdf(text) {
  const lines = text.match(/.{1,70}/g) ?? [text];
  const commands = lines
    .map((line, index) => {
      const escaped = line.replace(/([\\()])/g, "\\$1");
      return `${index === 0 ? "" : "0 -16 Td\n"}(${escaped}) Tj`;
    })
    .join("\n");
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
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}
