#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const pdfBuffer = createMinimalPdf("Official policy attachment evidence text. ".repeat(10));
const docBuffer = Buffer.from("legacy-doc-original-binary", "utf8");
let baseUrl = "";
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/policy.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>测试政策官方发布页</title></head><body><div class="article-meta">发文机关：测试机关　发布日期：2026-07-27</div><div class="TRS_Editor">现将政策印发，正文和名单详见附件。${"本发布页用于验证正文、附件、哈希和人工复核证据链。".repeat(12)}</div><a href="/policy.pdf">正式正文.pdf</a><a href="/legacy.doc">历史名单.doc</a></body></html>`);
    return;
  }
  if (url.pathname === "/policy.pdf") {
    response.writeHead(200, { "content-type": "application/pdf", "content-length": String(pdfBuffer.length) });
    response.end(pdfBuffer);
    return;
  }
  if (url.pathname === "/legacy.doc") {
    response.writeHead(200, { "content-type": "application/msword", "content-length": String(docBuffer.length) });
    response.end(docBuffer);
    return;
  }
  response.writeHead(404).end();
});

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-evidence-package-"));
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const policyJson = path.join(tempDir, "manual-policy.json");
  const outDir = path.join(tempDir, "evidence");
  await fs.writeFile(policyJson, JSON.stringify({
    mode: "getManualAnalysisPolicy",
    policy: {
      id: "00000000-0000-4000-8000-000000000001",
      title: "测试附件政策",
      issuer: "测试机关",
      publishDate: "2026-07-27",
      sourceName: "测试官方来源",
      sourceUrl: `${baseUrl}/policy.html`,
      fullText: "现将政策印发，正文和名单详见附件。"
    }
  }), "utf8");

  const result = await runChild(process.execPath, [
    path.resolve("scripts/fetch-policy-evidence-package.mjs"),
    `--policy-json=${policyJson}`,
    `--out-dir=${outDir}`
  ]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const manifest = JSON.parse(await fs.readFile(path.join(outDir, "manifest.json"), "utf8"));
  assert.equal(manifest.evidence.attachmentCount, 2);
  assert.equal(manifest.evidence.downloadedAttachmentCount, 2);
  assert.equal(manifest.evidence.unextractedAttachmentCount, 1);
  assert.equal(manifest.evidence.attachmentCollectionStatus, "complete");
  assert.equal(manifest.evidence.attachmentExtractionStatus, "partial");
  assert.equal(manifest.evidence.attachmentManualReviewRequired, true);
  assert.equal(manifest.attachments.filter((item) => item.archivePath).length, 2);
  assert.ok(manifest.attachments.every((item) => item.sha256?.length === 64));

  const attachmentFiles = await fs.readdir(path.join(outDir, "attachments"));
  assert.equal(attachmentFiles.length, 2);
  assert.ok(attachmentFiles.some((name) => name.endsWith(".pdf")));
  assert.ok(attachmentFiles.some((name) => name.endsWith(".doc")));
  assert.match(await fs.readFile(path.join(outDir, "evidence.txt"), "utf8"), /Official policy attachment evidence text/);
  assert.match(await fs.readFile(path.join(outDir, "source-page.html"), "utf8"), /历史名单\.doc/);
  await fs.access(path.join(outDir, "source-page.txt"));
  await fs.access(path.join(outDir, "manual-policy.json"));

  console.log("[manual:evidence-test] source page, extracted evidence, manifest, hashes, and original PDF/DOC attachments were archived");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tempDir, { recursive: true, force: true });
}

function runChild(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

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
