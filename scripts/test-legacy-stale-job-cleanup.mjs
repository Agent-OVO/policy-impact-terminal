#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-stale-job-cleanup-"));
try {
  const input = path.join(tempDir, "inbox.json");
  const output = path.join(tempDir, "report.json");
  await fs.writeFile(input, JSON.stringify({
    sincePublishDate: "2026-05-01",
    policies: [
      {
        id: "p1",
        title: "旧政策一",
        publishDate: "2026-05-10",
        manualReviewDisposition: "pending_review",
        staleOpenAnalysisJobCount: 3,
        requiresCloseOpenJob: true
      },
      {
        id: "p2",
        title: "旧政策二",
        publishDate: "2026-06-10",
        manualReviewDisposition: "pending_review",
        staleOpenAnalysisJobCount: 2,
        requiresCloseOpenJob: true
      },
      {
        id: "p3",
        title: "无债务政策",
        publishDate: "2026-06-12",
        manualReviewDisposition: "pending_review",
        staleOpenAnalysisJobCount: 0,
        requiresCloseOpenJob: false
      },
      {
        id: "p4",
        title: "已选择政策",
        publishDate: "2026-06-13",
        manualReviewDisposition: "selected_for_analysis",
        staleOpenAnalysisJobCount: 1,
        requiresCloseOpenJob: false
      },
      {
        id: "p5",
        title: "控制上线后政策",
        publishDate: "2026-07-20",
        manualReviewDisposition: "pending_review",
        staleOpenAnalysisJobCount: 4,
        requiresCloseOpenJob: true
      }
    ]
  }));

  const dryRun = await runChild([
    `--input=${input}`,
    `--output=${output}`,
    "--cutoff=2026-07-15"
  ]);
  assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
  const report = JSON.parse(await fs.readFile(output, "utf8"));
  assert.equal(report.mode, "dry_run");
  assert.equal(report.guard.actualPolicyCount, 2);
  assert.equal(report.guard.actualJobCount, 5);
  assert.equal(report.guard.excludedPolicyCount, 2);
  assert.equal(report.guard.excludedJobCount, 5);
  assert.deepEqual(report.candidates.map((item) => item.id), ["p1", "p2"]);
  assert.deepEqual(report.excluded.map((item) => item.id), ["p4", "p5"]);

  const cachedApply = await runChild([
    "--apply=true",
    "--confirmation=CLOSE_LEGACY_STALE_ANALYSIS_JOBS",
    "--expectedPolicies=2",
    "--expectedJobs=5",
    `--input=${input}`
  ]);
  assert.notEqual(cachedApply.status, 0);
  assert.match(cachedApply.stderr, /Apply mode must use a live inbox response/);

  const wrongConfirmation = await runChild([
    "--apply=true",
    "--confirmation=WRONG",
    "--expectedPolicies=2",
    "--expectedJobs=5"
  ]);
  assert.notEqual(wrongConfirmation.status, 0);
  assert.match(wrongConfirmation.stderr, /CLOSE_LEGACY_STALE_ANALYSIS_JOBS/);

  console.log("[legacy-stale-job-cleanup-test] dry-run boundary, excluded-policy guard, live-input requirement, and exact confirmation passed");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

function runChild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("scripts/cleanup-legacy-stale-analysis-jobs.mjs"), ...args], {
      cwd: process.cwd(),
      windowsHide: true,
      env: { ...process.env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}
