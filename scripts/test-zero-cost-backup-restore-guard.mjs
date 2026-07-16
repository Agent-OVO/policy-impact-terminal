#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const script = path.resolve("scripts/verify-zero-cost-production-backup.mjs");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-restore-guard-"));
const manifestPath = path.join(tempDir, "manifest.json");
const manifest = {
  formatVersion: "zero-cost-logical-backup-v1",
  backupId: "test-backup",
  projectRef: "test-project",
  readOnlyExport: true,
  additionalPaidResourcesCreated: false,
  encryption: { keyDerivation: "scrypt", saltBase64: Buffer.alloc(16, 1).toString("base64") },
  files: ["roles", "schema", "data"].map((kind) => ({
    kind,
    encryptedFile: `${kind}.sql.enc`,
    ivBase64: Buffer.alloc(12).toString("base64"),
    authTagBase64: Buffer.alloc(16).toString("base64"),
    plaintextSha256: "0".repeat(64),
    ciphertextSha256: "0".repeat(64)
  }))
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

try {
  const validationOnly = run([`--manifest=${path.join(tempDir, "missing.json")}`]);
  assert.equal(validationOnly.status, 0, validationOnly.output);
  assert.match(validationOnly.output, /no database connection was opened/);
  const remote = run(["--verify-restore", `--manifest=${manifestPath}`, "--target-url=postgresql://user:pass@example.com/policy_restore_verify_test"]);
  assert.notEqual(remote.status, 0);
  assert.match(remote.output, /local host/);
  const unsafeDatabase = run(["--verify-restore", `--manifest=${manifestPath}`, "--target-url=postgresql://user:pass@localhost/postgres"]);
  assert.notEqual(unsafeDatabase.status, 0);
  assert.match(unsafeDatabase.output, /must start with policy_restore_verify_/);
  const missingConfirmation = run(["--verify-restore", `--manifest=${manifestPath}`, "--target-url=postgresql://user:pass@localhost/policy_restore_verify_test"]);
  assert.notEqual(missingConfirmation.status, 0);
  assert.match(missingConfirmation.output, /RESTORE_CONFIRMATION=RESTORE_VERIFY:test-backup/);
  const missingKey = run(["--verify-restore", `--manifest=${manifestPath}`, "--target-url=postgresql://user:pass@localhost/policy_restore_verify_test"], {
    RESTORE_CONFIRMATION: "RESTORE_VERIFY:test-backup"
  });
  assert.notEqual(missingKey.status, 0);
  assert.match(missingKey.output, /BACKUP_ENCRYPTION_KEY/);
  console.log("[backup:restore-guard-test] local-only target, dedicated database, confirmation, and key guards passed");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function run(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, RESTORE_CONFIRMATION: "", BACKUP_ENCRYPTION_KEY: "", ...extraEnv },
    encoding: "utf8", windowsHide: true
  });
  return { status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}
