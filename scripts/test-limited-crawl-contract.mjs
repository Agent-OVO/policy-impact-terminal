#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const [crawler, workflow, recoveryWorkflow, packageJson, ingest] = await Promise.all([
  fs.readFile(new URL("./crawl-policy-sources.mjs", import.meta.url), "utf8"),
  fs.readFile(new URL("../.github/workflows/crawl-policies.yml", import.meta.url), "utf8"),
  fs.readFile(new URL("../.github/workflows/recover-policy-collection.yml", import.meta.url), "utf8"),
  fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../supabase/functions/ingest/index.ts", import.meta.url), "utf8")
]);

assert.match(crawler, /--manual-selection-only/);
assert.match(crawler, /automaticAnalysisSelection/);
assert.match(crawler, /analysisQueueSelected/);
assert.match(crawler, /manualReviewDisposition/);
assert.match(crawler, /buildLimitedPolicyPlan/);
assert.match(crawler, /hydratePolicyAttachments/);
assert.match(crawler, /miit-search-api-compact-fallback/);
assert.match(crawler, /miit-search-api-rich-mirror-fallback/);
assert.match(crawler, /miit-official-homepage-fallback/);
assert.match(crawler, /attachmentEvidenceIncomplete/);
assert.match(crawler, /awaiting_evidence/);
assert.match(crawler, /DEFAULT_CANDIDATE_LIMIT = 24/);
assert.match(crawler, /DEFAULT_INGEST_LIMIT = 24/);

assert.match(workflow, /cron: "17 \* \* \* \*"/);
assert.match(workflow, /--manual-selection-only/);
assert.match(workflow, /policy:triage-test/);
assert.match(workflow, /policy:crawl-contract-test/);
assert.match(workflow, /policy:hourly-operations-test/);
assert.doesNotMatch(workflow, /--auto-select-analysis/);

assert.match(recoveryWorkflow, /cron: "7,22,37,52 \* \* \* \*"/);
assert.match(recoveryWorkflow, /threshold_minutes \|\| '80'/);
assert.match(recoveryWorkflow, /--recovery-input=artifacts\/recovery\/recovery-runs\.json/);
assert.match(recoveryWorkflow, /--manual-selection-only/);
assert.match(recoveryWorkflow, /steps\.recovery\.outputs\.needed == 'true'/);

assert.match(ingest, /if \(!analysisQueueSelected\)/);
assert.match(ingest, /job: null/);
assert.match(ingest, /manualReviewDisposition/);
assert.match(ingest, /analysisQueueSelected: false/);
assert.match(ingest, /maybeBackfillExistingPolicy/);
assert.match(ingest, /published_or_analyzed_requires_explicit_revision/);
assert.match(ingest, /official_text_backfilled/);

const scripts = JSON.parse(packageJson).scripts;
assert.equal(scripts["operation:collect-hourly"], "node scripts/crawl-policy-sources.mjs --manual-selection-only");
assert.ok(scripts["policy:attachment-test"]);
assert.ok(scripts["policy:hourly-recovery-test"]);
assert.ok(scripts["policy:operations-test"]);

await testMiitOfficialMirrorFallback();
await testMiitOfficialHtmlFallback();

console.log("[policy:crawl-contract-test] hourly schedule, MIIT official mirror and HTML fallbacks, bounded collection, and manual analysis contract passed");

async function testMiitOfficialMirrorFallback() {
  const policyText = "本通知围绕制造业高质量发展部署重点任务，明确实施范围、工作要求、组织保障、监督管理和后续评估机制。".repeat(12);
  const pdfBuffer = createMinimalPdf("Official mirror attachment full text for deterministic extraction. ".repeat(10));
  let baseUrl = "";
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/primary/api/search/info") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "primary endpoint unavailable" }));
      return;
    }
    if (requestUrl.pathname === "/mirror/api/search/info") {
      const fields = [
        { fieldTitle: "正文", fieldName: "content", fieldType: "Text", fieldValue: `<p>${policyText}</p><p>具体名单详见附件。</p>` },
        { fieldTitle: "PDF附件预览", fieldName: "filepdf", fieldType: "Attach", fieldValue: JSON.stringify([
          { name: "测试政策完整附件.pdf", fileName: "policy.pdf", url: "/mirror/attachments/policy.pdf" }
        ]) }
      ];
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        success: true,
        data: {
          searchResult: {
            dataResults: [{
              data: {
                title: "工业和信息化部办公厅关于开展镜像采集测试任务的通知",
                url: `${baseUrl}/primary/article.html`,
                jsearch_date: "2026-07-16 09:00",
                publishgroupname: "工业和信息化部",
                filenumbername: "工信厅测函〔2026〕1号",
                infoextends: JSON.stringify({ infoContent: JSON.stringify(fields) }),
                infocontent: policyText.slice(0, 300),
                typename: "通知"
              }
            }]
          }
        }
      }));
      return;
    }
    if (requestUrl.pathname === "/primary/article.html") {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("primary article unavailable");
      return;
    }
    if (requestUrl.pathname === "/mirror/attachments/policy.pdf") {
      response.writeHead(200, { "content-type": "application/pdf", "content-length": String(pdfBuffer.length) });
      response.end(pdfBuffer);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "miit-mirror-contract-"));
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
    const outputPath = path.join(tempDir, "miit-mirror.json");
    const result = await runChild(process.execPath, [
      path.resolve("scripts/crawl-policy-sources.mjs"),
      "--source=miit_policy_library",
      "--source-scan-limit=20",
      "--candidate-limit=10",
      "--ingest-limit=10",
      "--analysis-limit=3",
      "--pending-queue-limit=8",
      "--since=2026-07-01",
      "--exclude-undated",
      "--manual-selection-only",
      `--out=${outputPath}`
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      env: {
        ...process.env,
        MIIT_SEARCH_API_URLS: `${baseUrl}/primary/api/search/info,${baseUrl}/mirror/api/search/info`,
        MIIT_FALLBACK_LIST_URL: `${baseUrl}/missing/`,
        MIIT_SEARCH_ATTEMPTS: "1",
        MIIT_MIRROR_SEARCH_ATTEMPTS: "1",
        MIIT_SEARCH_TIMEOUT_MS: "1000"
      }
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /official mirror recovered 1 rows/);
    const payload = JSON.parse(await fs.readFile(outputPath, "utf8"));
    assert.equal(payload.runStatus, "ok");
    assert.equal(payload.counts.collected, 1);
    assert.equal(payload.counts.candidates, 1);
    assert.equal(payload.counts.withFullText, 1);
    assert.equal(payload.counts.analysisSelected, 0);
    assert.equal(payload.sourceHealth[0].status, "ok");
    assert.equal(payload.sourceHealth[0].fallbackUsed, true);
    const candidate = payload.candidates[0];
    assert.equal(candidate.raw.origin, "miit-search-api-rich-mirror-fallback");
    assert.equal(candidate.raw.hydrationSource, "miit-search-index");
    assert.equal(candidate.raw.indexedAttachmentCount, 1);
    assert.equal(candidate.raw.attachmentExtractionStatus, "pdf_extracted");
    assert.equal(candidate.raw.attachmentEvidenceIncomplete, false);
    assert.ok(candidate.raw.attachmentTextLength >= 280);
    assert.match(candidate.fullText, /Official mirror attachment full text/);
    assert.ok(candidate.raw.primaryHydrationError);
    assert.equal(Object.hasOwn(candidate, "hydrationFallback"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testMiitOfficialHtmlFallback() {
  const policyText = "本通知围绕制造业高质量发展部署重点任务，明确实施范围、工作要求、组织保障、监督管理和后续评估机制。".repeat(12);
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/api/search/info") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "temporary upstream outage" }));
      return;
    }
    if (requestUrl.pathname === "/zwgk/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><div class="zwgk-zcwj"><div class="tabbox-bd-con"><ul>
        <li><span>2026-07-16</span><p><a href="/zwgk/zcwj/wjfb/tz/art/2026/art_test_one.html" title="工业和信息化部办公厅关于开展测试任务一的通知">工业和信息化部办公厅关于开展测试任务一的通知</a></p></li>
        <li><span>2026-07-15</span><p><a href="/zwgk/zcwj/wjfb/tz/art/2026/art_test_two.html" title="工业和信息化部办公厅关于开展测试任务二的通知">工业和信息化部办公厅关于开展测试任务二的通知</a></p></li>
      </ul></div></div></body></html>`);
      return;
    }
    if (requestUrl.pathname.includes("/zwgk/zcwj/wjfb/tz/art/2026/")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><div class="TRS_Editor">${policyText}</div></body></html>`);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "miit-fallback-contract-"));
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const outputPath = path.join(tempDir, "miit-fallback.json");
    const result = await runChild(process.execPath, [
      path.resolve("scripts/crawl-policy-sources.mjs"),
      "--source=miit_policy_library",
      "--source-scan-limit=20",
      "--candidate-limit=10",
      "--ingest-limit=10",
      "--analysis-limit=3",
      "--pending-queue-limit=8",
      "--since=2026-07-01",
      "--exclude-undated",
      "--manual-selection-only",
      `--out=${outputPath}`
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      env: {
        ...process.env,
        MIIT_SEARCH_API_URL: `${baseUrl}/api/search/info`,
        MIIT_FALLBACK_LIST_URL: `${baseUrl}/zwgk/`,
        MIIT_SEARCH_ATTEMPTS: "1",
        MIIT_SEARCH_TIMEOUT_MS: "1000"
      }
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /official HTML fallback recovered 2 recent policy rows/);
    const payload = JSON.parse(await fs.readFile(outputPath, "utf8"));
    assert.equal(payload.runStatus, "ok");
    assert.equal(payload.automaticAnalysisSelection, false);
    assert.equal(payload.counts.collected, 2);
    assert.ok(payload.counts.candidates >= 1);
    assert.equal(payload.counts.withFullText, payload.counts.candidates);
    assert.equal(payload.counts.analysisSelected, 0);
    assert.equal(payload.sourceHealth[0].status, "ok");
    assert.equal(payload.sourceHealth[0].fallbackUsed, true);
    assert.deepEqual(payload.sourceHealth[0].fetchModes, ["miit-official-homepage-fallback"]);
    assert.ok(payload.candidates.every((item) => item.raw?.origin === "miit-official-homepage-fallback"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

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
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function runChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}
