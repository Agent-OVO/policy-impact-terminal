#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";

const script = path.resolve("scripts/configure-production.mjs");
const validationOnly = run([]);
assert.equal(validationOnly.status, 0, validationOnly.output);
assert.match(validationOnly.output, /validation-only/);
assert.match(validationOnly.output, /No production write flag was supplied/);

for (const test of [
  { args: ["--apply-functions"], expected: /PRODUCTION_FUNCTION_DEPLOY_CONFIRMATION/ },
  { args: ["--apply-github-secrets"], expected: /PRODUCTION_SECRET_ROTATION_CONFIRMATION/ },
  { args: ["--apply-supabase-secrets"], expected: /PRODUCTION_SECRET_ROTATION_CONFIRMATION/ },
  { args: ["--apply-db-migrations"], expected: /PRODUCTION_DB_MIGRATION_CONFIRMATION/ },
  { args: ["--dispatch"], expected: /PRODUCTION_WORKFLOW_DISPATCH_CONFIRMATION/ }
]) {
  const result = run(test.args);
  assert.notEqual(result.status, 0, `${test.args.join(" ")} must be confirmation-gated`);
  assert.match(result.output, test.expected);
}

console.log("[setup:production-test] validation-only default and explicit production write confirmations passed");

function run(args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PRODUCTION_FUNCTION_DEPLOY_CONFIRMATION: "",
      PRODUCTION_SECRET_ROTATION_CONFIRMATION: "",
      PRODUCTION_DB_MIGRATION_CONFIRMATION: "",
      PRODUCTION_WORKFLOW_DISPATCH_CONFIRMATION: ""
    },
    encoding: "utf8",
    windowsHide: true
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}
