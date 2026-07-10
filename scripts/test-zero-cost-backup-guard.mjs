#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.resolve("scripts/create-zero-cost-production-backup.mjs");
const projectRef = "qxzspsofhmfjceuaulhu";
const expectedHost = "db.qxzspsofhmfjceuaulhu.supabase.co";
const projectFixture = JSON.stringify({
  id: projectRef,
  ref: projectRef,
  name: "policy-impact-terminal",
  status: "ACTIVE_HEALTHY",
  region: "ap-northeast-1",
  database: {
    host: expectedHost,
    version: "17.6.1",
    postgres_engine: "17"
  }
});

const validationOnly = run([]);
assert.equal(validationOnly.status, 0, "validation-only backup command must not require credentials");
assert.match(validationOnly.output, /no database connection was opened/);

const missingConfirmation = run(["--apply-readonly-backup"]);
assert.notEqual(missingConfirmation.status, 0, "backup export must require explicit confirmation");
assert.match(missingConfirmation.output, /BACKUP_CONFIRMATION=READ_ONLY_BACKUP:/);

const missingPassword = run(["--apply-readonly-backup"], {
  BACKUP_CONFIRMATION: `READ_ONLY_BACKUP:${projectRef}`
});
assert.notEqual(missingPassword.status, 0, "backup export must require a transient database password");
assert.match(missingPassword.output, /SUPABASE_DB_PASSWORD is required/);

const wrongHost = run(["--expected-host=db.wrong.invalid"]);
assert.notEqual(wrongHost.status, 0, "backup validation must reject a different database host");
assert.match(wrongHost.output, /Expected host db\.wrong\.invalid/);

console.log("[backup:guard-test] zero-cost backup guards passed");

function run(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ZERO_COST_BACKUP_TEST_PROJECT_JSON: projectFixture,
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
