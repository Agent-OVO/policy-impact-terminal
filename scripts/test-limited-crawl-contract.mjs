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

assert.match(recoveryWorkflow, /cron: "12,42 \* \* \* \*"/);
assert.match(recoveryWorkflow, /threshold_minutes \|\| '80'/);
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

await testMiitOfficialHtmlFallback();

console.log("[policy:crawl-contract-test] hourly schedule, MIIT official fallback, bounded collection, and manual analysis contract passed");

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
