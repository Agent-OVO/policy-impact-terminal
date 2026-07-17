#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hourly-recovery-test-"));
const input = path.join(tempDir, "runs.json");
const recoveryInput = path.join(tempDir, "recovery-runs.json");
const script = path.resolve("scripts/evaluate-hourly-recovery.mjs");
const runs = [
  { databaseId: 1, event: "schedule", status: "completed", conclusion: "success", createdAt: "2026-07-16T10:00:00Z" },
  { databaseId: 2, event: "workflow_dispatch", status: "completed", conclusion: "success", createdAt: "2026-07-16T10:30:00Z" }
];
fs.writeFileSync(input, JSON.stringify(runs), "utf8");
fs.writeFileSync(recoveryInput, JSON.stringify([]), "utf8");
try {
  const healthy = run([`--input=${input}`, "--now=2026-07-16T11:00:00Z", "--threshold-minutes=80"]);
  assert.equal(healthy.status, 0, healthy.output);
  assert.match(healthy.output, /needed=false/);
  assert.match(healthy.output, /recent_schedule_run_is_healthy/);

  const stale = run([`--input=${input}`, `--recovery-input=${recoveryInput}`, "--now=2026-07-16T11:30:01Z", "--threshold-minutes=80"]);
  assert.equal(stale.status, 0, stale.output);
  assert.match(stale.output, /needed=true/);
  assert.match(stale.output, /schedule_gap_exceeds_threshold/);

  fs.writeFileSync(recoveryInput, JSON.stringify([
    { databaseId: 20, event: "workflow_dispatch", status: "completed", conclusion: "success", createdAt: "2026-07-16T11:10:00Z" }
  ]), "utf8");
  const recentRecovery = run([`--input=${input}`, `--recovery-input=${recoveryInput}`, "--now=2026-07-16T11:30:01Z", "--threshold-minutes=80"]);
  assert.equal(recentRecovery.status, 0, recentRecovery.output);
  assert.match(recentRecovery.output, /needed=false/);
  assert.match(recentRecovery.output, /recent_schedule_run_is_healthy/);

  fs.writeFileSync(input, JSON.stringify([
    ...runs,
    { databaseId: 3, event: "schedule", status: "in_progress", conclusion: null, createdAt: "2026-07-16T11:29:00Z" }
  ]), "utf8");
  const active = run([`--input=${input}`, `--recovery-input=${recoveryInput}`, "--now=2026-07-16T11:30:01Z", "--threshold-minutes=80"]);
  assert.equal(active.status, 0, active.output);
  assert.match(active.output, /needed=false/);
  assert.match(active.output, /primary_schedule_run_active/);

  const forced = run([`--input=${input}`, "--now=2026-07-16T10:10:00Z", "--force"]);
  assert.equal(forced.status, 0, forced.output);
  assert.match(forced.output, /forced_by_explicit_dispatch/);

  console.log("[hourly:recovery-test] recent primary/recovery suppression, active-run suppression, stale-gap recovery, and explicit force passed");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function run(args) {
  const result = spawnSync(process.execPath, [script, `--out=${path.join(tempDir, "decision.json")}`, ...args], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}
