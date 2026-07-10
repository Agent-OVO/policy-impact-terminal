#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve("scripts/configure-production.mjs");
const projectRef = "qxzspsofhmfjceuaulhu";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "production-guard-test-"));
const readinessReport = path.join(tempDir, "readiness.json");
fs.writeFileSync(readinessReport, JSON.stringify({
  generatedAt: new Date().toISOString(),
  projectRef,
  project: { ref: projectRef },
  costPolicy: { additionalPaidResourcesAllowed: false },
  productionWriteReady: false,
  blockers: ["test_blocker"]
}), "utf8");

const noApply = run([]);
assert.notEqual(noApply.status, 0, "production setup must fail without --apply-production");
assert.match(noApply.output, /Production mutation is disabled by default/);
assert.doesNotMatch(noApply.output, /Supabase API keys loaded/);

const noConfirmation = run(["--apply-production"]);
assert.notEqual(noConfirmation.status, 0, "production setup must fail without confirmation phrase");
assert.match(noConfirmation.output, /PRODUCTION_CONFIRMATION=APPLY:/);
assert.doesNotMatch(noConfirmation.output, /Supabase API keys loaded/);

const blockedReadiness = run([
  "--apply-production",
  `--readiness-report=${readinessReport}`
], {
  PRODUCTION_CONFIRMATION: `APPLY:${projectRef}`
});
assert.notEqual(blockedReadiness.status, 0, "production setup must fail while readiness blockers remain");
assert.match(blockedReadiness.output, /Production readiness gate is closed/);
assert.doesNotMatch(blockedReadiness.output, /Supabase API keys loaded/);

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("[production:guard-test] production mutation guards passed");

function run(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SUPABASE_PROJECT_REF: projectRef,
      ...extraEnv
    },
    encoding: "utf8",
    windowsHide: true
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  };
}
