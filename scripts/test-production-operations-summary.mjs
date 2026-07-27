#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "operations-summary-"));
try {
  const hourly = path.join(tempDir, "hourly.json");
  const current = path.join(tempDir, "current.json");
  const historical = path.join(tempDir, "historical.json");
  const registry = path.join(tempDir, "registry.json");
  const outJson = path.join(tempDir, "summary.json");
  const outMarkdown = path.join(tempDir, "summary.md");

  await fs.writeFile(hourly, JSON.stringify([
    { databaseId: 1, event: "schedule", conclusion: "success", createdAt: "2026-07-27T00:17:00Z" },
    { databaseId: 2, event: "schedule", conclusion: "success", createdAt: "2026-07-27T01:17:00Z" }
  ]));
  const policies = [
    {
      id: "a",
      title: "两部门关于公布网络安全保险试点名单的通知",
      publishDate: "2026-07-17",
      sourceUrl: "https://example.gov.cn/policy.html",
      fullTextLength: 600,
      manualReviewDisposition: "pending_review"
    },
    {
      id: "b",
      title: "两部门关于公布网络安全保险试点名单的通知",
      publishDate: "2026-07-17",
      sourceUrl: "https://example.gov.cn/policy.html#top",
      fullTextLength: 1900,
      manualReviewDisposition: "pending_review"
    },
    {
      id: "c",
      title: "附件政策",
      publishDate: "2026-07-27",
      sourceUrl: "https://example.gov.cn/attachment-policy",
      fullTextLength: 300,
      manualReviewDisposition: "awaiting_evidence",
      manualReviewReason: "等待DOC附件完整下载"
    }
  ];
  await fs.writeFile(current, JSON.stringify({
    sincePublishDate: "2026-07-15",
    total: 3,
    count: 3,
    stateCounts: { pendingReview: 2, awaitingEvidence: 1, selectedForAnalysis: 0 },
    policies
  }));
  await fs.writeFile(historical, JSON.stringify({
    sincePublishDate: "2026-05-01",
    total: 3,
    count: 3,
    stateCounts: { pendingReview: 2, awaitingEvidence: 1, selectedForAnalysis: 0 },
    policies
  }));
  await fs.writeFile(registry, JSON.stringify({ reports: [] }));

  const result = await runChild(process.execPath, [
    path.resolve("scripts/build-production-operations-summary.mjs"),
    `--hourly-runs=${hourly}`,
    `--current-inbox=${current}`,
    `--historical-inbox=${historical}`,
    `--registry=${registry}`,
    `--out-json=${outJson}`,
    `--out-markdown=${outMarkdown}`,
    "--since=2026-07-27T00:00:00Z"
  ], {
    GITHUB_REPOSITORY: "Agent-OVO/policy-impact-terminal",
    GITHUB_RUN_ID: "999",
    GITHUB_RUN_ATTEMPT: "2"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(await fs.readFile(outJson, "utf8"));
  assert.equal(summary.formatVersion, "production-operations-summary-v2");
  assert.equal(summary.authority.workflowRunId, "999");
  assert.equal(summary.authority.staticDocumentationIsRealtimeAuthority, false);
  assert.equal(summary.historicalInbox.duplicateGroupCount, 1);
  assert.equal(summary.historicalInbox.exactUrlDuplicateGroupCount, 1);
  assert.equal(summary.historicalInbox.attachmentEvidencePending, 1);
  assert.equal(summary.hourlyCollection.latestScheduledRunId, 2);
  const markdown = await fs.readFile(outMarkdown, "utf8");
  assert.match(markdown, /快照时间/);
  assert.match(markdown, /工作流运行：999/);
  assert.match(markdown, /附件正文待证：1项/);
  assert.match(markdown, /静态状态文档不作为实时数量权威源/);

  console.log("[operations:summary-test] immutable as-of manifest, run identity, duplicate integrity, and attachment evidence counts passed");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

function runChild(command, args, envPatch) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
      env: { ...process.env, ...envPatch }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}
