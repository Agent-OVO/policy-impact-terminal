#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.resolve("scripts/run-production-source-export.mjs");
const projectRef = "qxzspsofhmfjceuaulhu";
const expectedUrl = `https://${projectRef}.supabase.co`;

const validationOnly = run([]);
assert.equal(validationOnly.status, 0);
assert.match(validationOnly.output, /no production request was sent/);

const missingConfirmation = run(["--apply-readonly-export"]);
assert.notEqual(missingConfirmation.status, 0);
assert.match(missingConfirmation.output, /SOURCE_EXPORT_CONFIRMATION=READ_ONLY_SOURCE_EXPORT:/);

const missingCredential = run(["--apply-readonly-export"], {
  SOURCE_EXPORT_CONFIRMATION: `READ_ONLY_SOURCE_EXPORT:${projectRef}`
});
assert.notEqual(missingCredential.status, 0);
assert.match(missingCredential.output, /transient accepted admin\/crawler credential/);

const wrongTarget = run([], {
  SUPABASE_URL: "https://wrong-project.supabase.co"
});
assert.notEqual(wrongTarget.status, 0);
assert.match(wrongTarget.output, /Supabase URL mismatch/);

console.log("[production:source-guard-test] read-only source export guards passed");

function run(args, extraEnv = {}) {
  const minimalEnv = {
    PATH: process.env.PATH ?? "",
    Path: process.env.Path ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    TEMP: process.env.TEMP ?? "",
    TMP: process.env.TMP ?? "",
    SUPABASE_URL: expectedUrl,
    ...extraEnv
  };
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: minimalEnv,
    encoding: "utf8",
    windowsHide: true
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  };
}
