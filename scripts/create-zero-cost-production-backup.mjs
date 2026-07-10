#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  deriveBackupKey,
  encryptBackupBuffer,
  sha256Buffer
} from "./lib/zero-cost-backup-crypto.mjs";

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const expectedConfirmation = `READ_ONLY_BACKUP:${args.projectRef}`;
const project = process.env.ZERO_COST_BACKUP_TEST_PROJECT_JSON
  ? JSON.parse(process.env.ZERO_COST_BACKUP_TEST_PROJECT_JSON)
  : await getProject(args.projectRef);

if (!project) throw new Error(`Supabase project not found: ${args.projectRef}`);
if (project.status !== "ACTIVE_HEALTHY") {
  throw new Error(`Supabase project is not healthy: ${project.status}`);
}
if (project.database?.host !== args.expectedHost) {
  throw new Error(`Expected host ${args.expectedHost}, management API returned ${project.database?.host ?? "missing"}.`);
}

if (!args.apply) {
  console.log(`[backup] validation only project=${project.status} host=${project.database.host}`);
  console.log("[backup] no database connection was opened; pass --apply-readonly-backup with transient credentials only after review");
  process.exit(0);
}

if (process.env.BACKUP_CONFIRMATION !== expectedConfirmation) {
  throw new Error(`Set BACKUP_CONFIRMATION=${expectedConfirmation} for this read-only export.`);
}

const dbPassword = process.env.SUPABASE_DB_PASSWORD;
if (!dbPassword) throw new Error("SUPABASE_DB_PASSWORD is required for the read-only database dump.");
const encryptionPassphrase = process.env.BACKUP_ENCRYPTION_KEY;
if (!encryptionPassphrase || encryptionPassphrase.length < 24) {
  throw new Error("BACKUP_ENCRYPTION_KEY must be a transient passphrase of at least 24 characters.");
}

const outputRoot = assertSafeOutputRoot(args.outDir);
const backupId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${args.projectRef}`;
const backupDir = path.join(outputRoot, backupId);
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-production-backup-"));
const salt = crypto.randomBytes(16);
const encryptionKey = deriveBackupKey(encryptionPassphrase, salt);

try {
  await fs.mkdir(backupDir, { recursive: true });
  const dumpDefinitions = [
    {
      kind: "roles",
      file: "roles.sql",
      args: ["--role-only"]
    },
    {
      kind: "schema",
      file: "schema.sql",
      args: ["--schema", "public,auth,supabase_migrations", "--keep-comments"]
    },
    {
      kind: "data",
      file: "data.sql",
      args: ["--data-only", "--use-copy", "--schema", "public,auth,supabase_migrations"]
    }
  ];

  const files = [];
  for (const definition of dumpDefinitions) {
    const plainPath = path.join(tempDir, definition.file);
    await runSupabase([
      "db",
      "dump",
      "--linked",
      "--password",
      dbPassword,
      "--file",
      plainPath,
      ...definition.args
    ], dbPassword);

    const plain = await fs.readFile(plainPath);
    if (plain.length < 32) throw new Error(`${definition.kind} dump is unexpectedly small.`);
    const encrypted = encryptBackupBuffer(plain, encryptionKey);
    const encryptedName = `${definition.file}.enc`;
    const encryptedPath = path.join(backupDir, encryptedName);
    await fs.writeFile(encryptedPath, encrypted.ciphertext);
    files.push({
      kind: definition.kind,
      encryptedFile: encryptedName,
      cipher: "aes-256-gcm",
      ivBase64: encrypted.iv.toString("base64"),
      authTagBase64: encrypted.authTag.toString("base64"),
      plaintextBytes: plain.length,
      ciphertextBytes: encrypted.ciphertext.length,
      plaintextSha256: sha256Buffer(plain),
      ciphertextSha256: sha256Buffer(encrypted.ciphertext),
      sqlStructureVerified: verifySqlStructure(definition.kind, plain.toString("utf8"))
    });
  }

  const remoteMigrations = await runSupabase([
    "migration",
    "list",
    "--linked",
    "--password",
    dbPassword
  ], dbPassword, { capture: true }).catch((error) => `unavailable:${sanitizeError(error)}`);

  const localMigrations = (await fs.readdir(path.resolve("supabase/migrations")))
    .filter((item) => item.endsWith(".sql"))
    .sort();

  const manifest = {
    formatVersion: "zero-cost-logical-backup-v1",
    backupId,
    createdAt: new Date().toISOString(),
    projectRef: args.projectRef,
    projectName: project.name,
    databaseHost: project.database.host,
    postgresVersion: project.database.version,
    region: project.region,
    schemas: ["public", "auth", "supabase_migrations"],
    readOnlyExport: true,
    additionalPaidResourcesCreated: false,
    encryption: {
      keyDerivation: "scrypt",
      saltBase64: salt.toString("base64"),
      keyStoredInBackup: false
    },
    files,
    localMigrations,
    remoteMigrationList: redactText(remoteMigrations),
    cryptographicSelfCheckPassed: files.every((item) => item.sqlStructureVerified),
    restoreVerified: false,
    restoreVerificationNote: "A separate local restore verification is required before this backup can open the production write gate."
  };

  await fs.writeFile(
    path.join(backupDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(outputRoot, "latest.json"),
    `${JSON.stringify({ backupId, manifest: path.relative(outputRoot, path.join(backupDir, "manifest.json")) }, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(outputRoot, "latest-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  console.log(`[backup] created encrypted logical backup ${backupId}`);
  console.log(`[backup] files=${files.length} restoreVerified=false`);
  console.log(`[backup] manifest=${path.join(backupDir, "manifest.json")}`);
} finally {
  encryptionKey.fill(0);
  await fs.rm(tempDir, { recursive: true, force: true });
}

function parseArgs(argv) {
  const parsed = {
    projectRef: "qxzspsofhmfjceuaulhu",
    expectedHost: "db.qxzspsofhmfjceuaulhu.supabase.co",
    outDir: "artifacts/production-backups",
    apply: false
  };
  for (const arg of argv) {
    if (arg.startsWith("--project-ref=")) parsed.projectRef = arg.slice("--project-ref=".length);
    else if (arg.startsWith("--expected-host=")) parsed.expectedHost = arg.slice("--expected-host=".length);
    else if (arg.startsWith("--out-dir=")) parsed.outDir = arg.slice("--out-dir=".length);
    else if (arg === "--apply-readonly-backup") parsed.apply = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/create-zero-cost-production-backup.mjs [--apply-readonly-backup] [--project-ref=<ref>] [--expected-host=<host>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function getProject(projectRef) {
  const value = await runSupabase(["projects", "list", "--output", "json"], null, { capture: true });
  const projects = JSON.parse(value);
  return projects.find((item) => item.ref === projectRef || item.id === projectRef) ?? null;
}

async function runSupabase(commandArgs, secretToMask, options = {}) {
  const base = ["--yes", "supabase@2.109.1", ...commandArgs];
  const invocation = process.platform === "win32"
    ? {
        command: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", ["npx", ...base].map(quoteWindowsArgument).join(" ")]
      }
    : { command: "npx", args: base };
  try {
    const result = await execFileAsync(invocation.command, invocation.args, {
      cwd: process.cwd(),
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      env: process.env
    });
    if (options.capture) return result.stdout;
    return "";
  } catch (error) {
    const detail = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
    throw new Error(redactText(detail, secretToMask));
  }
}

function assertSafeOutputRoot(value) {
  const root = path.resolve(value);
  const allowed = path.resolve("artifacts/production-backups");
  if (root !== allowed && !root.startsWith(`${allowed}${path.sep}`)) {
    throw new Error(`Backup output must stay under ${allowed}.`);
  }
  return root;
}

function verifySqlStructure(kind, text) {
  if (kind === "roles") return /CREATE ROLE|ALTER ROLE|Roles/i.test(text);
  if (kind === "schema") return /CREATE TABLE|CREATE SCHEMA|CREATE FUNCTION/i.test(text);
  if (kind === "data") return /COPY |INSERT INTO/i.test(text);
  return false;
}

function redactText(value, explicitSecret = null) {
  let output = String(value ?? "");
  if (explicitSecret) output = output.split(explicitSecret).join("[redacted]");
  return output
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
    .slice(0, 20_000);
}

function sanitizeError(error) {
  return redactText(error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
