#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "operations-summary-"));
try {
  const hourly = path.join(tempDir, "hourly.json");
  const recovery = path.join(tempDir, "recovery.json");
  const liveness = path.join(tempDir, "liveness.json");
  const current = path.join(tempDir, "current.json");
  const historical = path.join(tempDir, "historical.json");
  const registry = path.join(tempDir, "registry.json");
  const outJson = path.join(tempDir, "summary.json");
  const outMarkdown = path.join(tempDir, "summary.md");

  await fs.writeFile(hourly, JSON.stringify([
    {
      databaseId: 1,
      event: "schedule",
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-27T00:17:00Z",
      updatedAt: "2026-07-27T00:20:00Z"
    },
    {
      databaseId: 2,
      event: "schedule",
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-27T01:17:00Z",
      updatedAt: "2026-07-27T01:20:00Z"
    }
  ]));
  await fs.writeFile(recovery, JSON.stringify([
    {
      databaseId: 10,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-27T01:40:00Z",
      updatedAt: "2026-07-27T01:45:00Z",
      recoveryPerformed: true
    },
    {
      databaseId: 11,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-07-27T01:50:00Z",
      updatedAt: "2026-07-27T01:51:00Z",
      recoveryPerformed: false
    }
  ]));
  await fs.writeFile(liveness, JSON.stringify([
    {
      databaseId: 20,
      status: "in_progress",
      conclusion: null,
      createdAt: "2026-07-27T01:50:00Z",
      updatedAt: "2026-07-27T01:55:00Z"
    }
  ]));

  const policies = [
    {
      id: "a",
      title: "两部门关于公布网络安全保险试点名单的通知",
      publishDate: "2026-07-17",
      sourceUrl: "https://example.gov.cn/policy.html",
      fullTextLength: 600,
      manualReviewDisposition: "pending_review",
      openAnalysisJobCount: 3,
      staleOpenAnalysisJobCount: 3,
      requiresCloseOpenJob: true
    },
    {
      id: "b",
      title: "两部门关于公布网络安全保险试点名单的通知",
      publishDate: "2026-07-17",
      sourceUrl: "https://example.gov.cn/policy.html#top",
      fullTextLength: 1900,
      manualReviewDisposition: "pending_review",
      openAnalysisJobCount: 0,
      staleOpenAnalysisJobCount: 0,
      requiresCloseOpenJob: false
    },
    {
      id: "c",
      title: "附件政策",
      publishDate: "2026-07-27",
      sourceUrl: "https://example.gov.cn/attachment-policy",
      fullTextLength: 300,
      manualReviewDisposition: "awaiting_evidence",
      manualReviewReason: "等待DOC附件完整下载",
      openAnalysisJobCount: 2,
      staleOpenAnalysisJobCount: 2,
      requiresCloseOpenJob: true
    }
  ];
  await fs.writeFile(current, JSON.stringify({
    sincePublishDate: "2026-07-15",
    total: 3,
    count: 3,
    stateCounts: {
      pendingReview: 2,
      awaitingEvidence: 1,
      selectedForAnalysis: 0,
      totalOpenAnalysisJobs: 5,
      policiesWithOpenAnalysisJobs: 2,
      staleOpenAnalysisJobs: 5,
      policiesWithStaleOpenAnalysisJobs: 2
    },
    policies
  }));
  await fs.writeFile(historical, JSON.stringify({
    sincePublishDate: "2026-05-01",
    total: 3,
    count: 3,
    stateCounts: {
      pendingReview: 2,
      awaitingEvidence: 1,
      selectedForAnalysis: 0,
      totalOpenAnalysisJobs: 5,
      policiesWithOpenAnalysisJobs: 2,
      staleOpenAnalysisJobs: 5,
      policiesWithStaleOpenAnalysisJobs: 2
    },
    policies
  }));
  await fs.writeFile(registry, JSON.stringify({ reports: [] }));

  const result = await runChild(process.execPath, [
    path.resolve("scripts/build-production-operations-summary.mjs"),
    `--hourly-runs=${hourly}`,
    `--recovery-runs=${recovery}`,
    `--liveness-runs=${liveness}`,
    `--current-inbox=${current}`,
    `--historical-inbox=${historical}`,
    `--registry=${registry}`,
    `--out-json=${outJson}`,
    `--out-markdown=${outMarkdown}`,
    "--since=2026-07-27T00:00:00Z",
    "--as-of=2026-07-27T02:00:00Z",
    "--freshness-threshold-minutes=80"
  ], {
    GITHUB_REPOSITORY: "Agent-OVO/policy-impact-terminal",
    GITHUB_RUN_ID: "999",
    GITHUB_RUN_ATTEMPT: "2"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(await fs.readFile(outJson, "utf8"));
  assert.equal(summary.formatVersion, "production-operations-summary-v3");
  assert.equal(summary.asOf, "2026-07-27T02:00:00.000Z");
  assert.equal(summary.authority.workflowRunId, "999");
  assert.equal(summary.authority.staticDocumentationIsRealtimeAuthority, false);
  assert.equal(summary.collectionHealth.status, "healthy");
  assert.equal(summary.collectionHealth.latestEffectiveRunId, 10);
  assert.equal(summary.collectionHealth.latestEffectiveRunKind, "recovery");
  assert.equal(summary.collectionHealth.effectiveAgeMinutes, 15);
  assert.equal(summary.collectionHealth.recoveryBacked, true);
  assert.equal(summary.hourlyCollection.latestScheduledRunId, 2);
  assert.equal(summary.hourlyCollection.maxObservedScheduledGapMinutes, 60);
  assert.equal(summary.recoveryCollection.performedRuns, 1);
  assert.equal(summary.recoveryCollection.latestPerformedRunId, 10);
  assert.equal(summary.remoteLiveness.active, true);
  assert.equal(summary.remoteLiveness.latestActiveRunId, 20);
  assert.equal(summary.historicalInbox.duplicateGroupCount, 1);
  assert.equal(summary.historicalInbox.exactUrlDuplicateGroupCount, 1);
  assert.equal(summary.historicalInbox.attachmentEvidencePending, 1);
  assert.equal(summary.currentInbox.totalOpenAnalysisJobs, 5);
  assert.equal(summary.currentInbox.staleOpenAnalysisJobs, 5);
  assert.equal(summary.historicalInbox.policiesWithStaleOpenAnalysisJobs, 2);

  const markdown = await fs.readFile(outMarkdown, "utf8");
  assert.match(markdown, /有效采集健康度/);
  assert.match(markdown, /状态：healthy/);
  assert.match(markdown, /恢复链已完成补采/);
  assert.match(markdown, /最大主定时间隔：60分钟/);
  assert.match(markdown, /当前活动是（run 20）/);
  assert.match(markdown, /附件正文待证：1项/);
  assert.match(markdown, /陈旧任务5个、涉及2项/);
  assert.match(markdown, /静态状态文档不作为实时权威源/);

  console.log("[operations:summary-test] effective freshness, recovery-backed health, liveness state, stale-job visibility, duplicate integrity, and attachment evidence counts passed");
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
