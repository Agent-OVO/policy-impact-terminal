#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hourly-recovery-test-"));
const input = path.join(tempDir, "runs.json");
const script = path.resolve("scripts/evaluate-hourly-recovery.mjs");
const runs = [
  { databaseId: 1, event: "schedule", status: "completed", conclusion: "success", createdAt: "2026-07-16T10:00:00Z" },
  { databaseId: 2, event: "workflow_dispatch", status: "completed", conclusion: "success", createdAt: "2026-07-16T10:30:00Z" }
];
fs.writeFileSync(input, JSON.stringify(runs), "utf8");
try {
  const healthy = run([`--input=${input}`, "--now=2026-07-16T11:00:00Z", "--threshold-minutes=80"]);
  assert.equal(healthy.status, 0, healthy.output);
  assert.match(healthy.output, /needed=false/);
  assert.match(healthy.output, /recent_schedule_run_is_healthy/);

  const stale = run([`--input=${input}`, "--now=2026-07-16T11:30:01Z", "--threshold-minutes=80"]);
  assert.equal(stale.status, 0, stale.output);
  assert.match(stale.output, /needed=true/);
  assert.match(stale.output, /schedule_gap_exceeds_threshold/);

  const forced = run([`--input=${input}`, "--now=2026-07-16T10:10:00Z", "--force"]);
  assert.equal(forced.status, 0, forced.output);
  assert.match(forced.output, /forced_by_explicit_dispatch/);

  console.log("[hourly:recovery-test] recent-run suppression, stale-gap recovery, and explicit force passed");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function run(args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}
