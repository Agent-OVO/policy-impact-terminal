#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage7-db-guard-"));
const shadowPath = path.join(tempDir, "shadow.json");
const actorId = "00000000-0000-0000-0000-000000000001";
await fs.writeFile(shadowPath, JSON.stringify({
  deploymentReady: true,
  counts: { reports: 0 },
  revisions: [],
  sourceDocuments: []
}), "utf8");

try {
  const validation = run([
    `--shadow-package=${shadowPath}`,
    `--actor-id=${actorId}`,
    "--target=staging"
  ]);
  assert.equal(validation.status, 0, validation.stderr);
  assert.match(validation.stdout, /no database connection was opened/i);

  const productionSeed = run([
    `--shadow-package=${shadowPath}`,
    `--actor-id=${actorId}`,
    "--target=production",
    "--seed-missing-policies"
  ]);
  assert.notEqual(productionSeed.status, 0);
  assert.match(productionSeed.stderr, /allowed only for staging/i);

  const noConfirmation = run([
    `--shadow-package=${shadowPath}`,
    `--actor-id=${actorId}`,
    "--target=staging",
    "--apply"
  ]);
  assert.notEqual(noConfirmation.status, 0);
  assert.match(noConfirmation.stderr, /requires --confirm=APPLY_STAGE7_STAGING/i);

  const noBackup = run([
    `--shadow-package=${shadowPath}`,
    `--actor-id=${actorId}`,
    "--target=production",
    "--apply",
    "--confirm=APPLY_STAGE7_PRODUCTION"
  ], {
    STAGE7_BACKUP_REFERENCE: "",
    STAGE7_DATABASE_URL: ""
  });
  assert.notEqual(noBackup.status, 0);
  assert.match(noBackup.stderr, /STAGE7_BACKUP_REFERENCE/i);

  console.log("[stage7:guard-test] database load safety guards passed");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

function run(args, envOverrides = {}) {
  const result = spawnSync(process.execPath, [
    path.resolve("scripts/apply-stage7-shadow-database.mjs"),
    ...args
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ...envOverrides },
    encoding: "utf8",
    windowsHide: true
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}
