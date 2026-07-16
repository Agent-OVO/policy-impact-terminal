#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import {
  decryptBackupBuffer,
  deriveBackupKey,
  sha256Buffer
} from "./lib/zero-cost-backup-crypto.mjs";

const args = parseArgs(process.argv.slice(2));
const manifestPath = path.resolve(args.manifest);
const manifest = await readJsonIfExists(manifestPath);
const psql = findExecutable("psql");

if (!args.verifyRestore) {
  console.log(`[backup:restore] validation only manifest=${manifest ? "present" : "missing"} psql=${psql ?? "missing"}`);
  console.log("[backup:restore] no database connection was opened; actual verification requires --verify-restore, a dedicated local database, transient encryption key, and exact confirmation");
  process.exit(0);
}

if (!manifest) throw new Error(`Backup manifest not found: ${manifestPath}`);
validateManifest(manifest);
const target = parseLocalRestoreTarget(args.targetUrl);
const expectedConfirmation = `RESTORE_VERIFY:${manifest.backupId}`;
if (process.env.RESTORE_CONFIRMATION !== expectedConfirmation) {
  throw new Error(`Set RESTORE_CONFIRMATION=${expectedConfirmation} only for the dedicated local restore database.`);
}
const passphrase = process.env.BACKUP_ENCRYPTION_KEY;
if (!passphrase || passphrase.length < 24) throw new Error("BACKUP_ENCRYPTION_KEY must be a transient passphrase of at least 24 characters.");
if (!psql) throw new Error("psql is required for actual restore verification and was not found on PATH.");

const manifestDirectory = resolveBackupDirectory(manifestPath, manifest);
const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "policy-backup-restore-"));
const key = deriveBackupKey(passphrase, Buffer.from(manifest.encryption.saltBase64, "base64"));
const verifiedFiles = [];
try {
  for (const file of manifest.files) {
    const encryptedPath = path.join(manifestDirectory, file.encryptedFile);
    const ciphertext = await fs.readFile(encryptedPath);
    if (sha256Buffer(ciphertext) !== file.ciphertextSha256) throw new Error(`Ciphertext hash mismatch: ${file.encryptedFile}`);
    const plain = decryptBackupBuffer({
      ciphertext,
      iv: Buffer.from(file.ivBase64, "base64"),
      authTag: Buffer.from(file.authTagBase64, "base64")
    }, key);
    if (sha256Buffer(plain) !== file.plaintextSha256) throw new Error(`Plaintext hash mismatch: ${file.encryptedFile}`);
    if (!verifySqlStructure(file.kind, plain.toString("utf8"))) throw new Error(`Decrypted SQL structure check failed: ${file.kind}`);
    const plainPath = path.join(tempDirectory, `${file.kind}.sql`);
    await fs.writeFile(plainPath, plain);
    verifiedFiles.push({ ...file, plainPath });
  }

  for (const kind of ["roles", "schema", "data"]) {
    const file = verifiedFiles.find((item) => item.kind === kind);
    if (!file) throw new Error(`Backup is missing required ${kind} SQL.`);
    runPsql(psql, args.targetUrl, ["--set", "ON_ERROR_STOP=1", "--file", file.plainPath]);
  }

  const checks = [
    { name: "public_policies_table", sql: "select (to_regclass('public.policies') is not null)::text;", expected: "true" },
    { name: "auth_users_table", sql: "select (to_regclass('auth.users') is not null)::text;", expected: "true" },
    { name: "migration_table", sql: "select (to_regclass('supabase_migrations.schema_migrations') is not null)::text;", expected: "true" },
    { name: "policies_readable", sql: "select (count(*) >= 0)::text from public.policies;", expected: "true" }
  ].map((check) => {
    const actual = runPsql(psql, args.targetUrl, ["--tuples-only", "--no-align", "--command", check.sql], true).trim();
    if (actual !== check.expected) throw new Error(`Restore check failed: ${check.name} expected=${check.expected} actual=${actual}`);
    return { ...check, actual, passed: true };
  });

  const verifiedAt = new Date().toISOString();
  const verification = {
    formatVersion: "zero-cost-logical-backup-restore-verification-v1",
    backupId: manifest.backupId,
    projectRef: manifest.projectRef,
    verifiedAt,
    target: { host: target.hostname, port: target.port || "5432", database: target.database, localOnly: true },
    files: verifiedFiles.map(({ plainPath: ignored, ...item }) => ({
      kind: item.kind,
      encryptedFile: item.encryptedFile,
      plaintextSha256: item.plaintextSha256,
      ciphertextSha256: item.ciphertextSha256,
      verified: true
    })),
    checks,
    passed: true
  };
  await writeJson(args.out, verification);
  const updatedManifest = {
    ...manifest,
    restoreVerified: true,
    restoreVerifiedAt: verifiedAt,
    restoreVerificationReport: path.relative(path.dirname(manifestPath), path.resolve(args.out)).replaceAll("\\", "/"),
    restoreVerificationNote: "Encrypted backup was decrypted, restored into a dedicated local database, and queried successfully."
  };
  await writeJson(manifestPath, updatedManifest);
  const canonicalManifest = path.join(manifestDirectory, "manifest.json");
  if (canonicalManifest !== manifestPath) await writeJson(canonicalManifest, updatedManifest);
  console.log(`[backup:restore] verified backup=${manifest.backupId} database=${target.database} checks=${checks.length}`);
} finally {
  key.fill(0);
  await fs.rm(tempDirectory, { recursive: true, force: true });
}

function parseArgs(argv) {
  const parsed = {
    manifest: "artifacts/production-backups/latest-manifest.json",
    out: "artifacts/production-backups/latest-restore-verification.json",
    targetUrl: process.env.RESTORE_DATABASE_URL ?? "",
    verifyRestore: false
  };
  for (const arg of argv) {
    if (arg.startsWith("--manifest=")) parsed.manifest = arg.slice("--manifest=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg.startsWith("--target-url=")) parsed.targetUrl = arg.slice("--target-url=".length);
    else if (arg === "--verify-restore") parsed.verifyRestore = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/verify-zero-cost-production-backup.mjs [--verify-restore --target-url=postgresql://.../policy_restore_verify_<id>]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function validateManifest(value) {
  if (value.formatVersion !== "zero-cost-logical-backup-v1") throw new Error("Unsupported backup manifest format.");
  if (!value.backupId || !value.projectRef) throw new Error("Backup manifest identity is incomplete.");
  if (value.readOnlyExport !== true || value.additionalPaidResourcesCreated !== false) throw new Error("Backup manifest does not satisfy the read-only zero-cost boundary.");
  if (value.encryption?.keyDerivation !== "scrypt" || !value.encryption?.saltBase64) throw new Error("Backup encryption metadata is incomplete.");
  if (!Array.isArray(value.files) || value.files.length < 3) throw new Error("Backup manifest must contain roles, schema, and data files.");
}
function parseLocalRestoreTarget(rawUrl) {
  if (!rawUrl) throw new Error("--target-url or RESTORE_DATABASE_URL is required for actual restore verification.");
  const value = new URL(rawUrl);
  if (!["postgres:", "postgresql:"].includes(value.protocol)) throw new Error("Restore target must use a PostgreSQL URL.");
  if (!["localhost", "127.0.0.1", "::1"].includes(value.hostname)) throw new Error("Restore verification target must be a local host; remote databases are forbidden.");
  const database = decodeURIComponent(value.pathname.replace(/^\//, ""));
  if (!database.startsWith("policy_restore_verify_")) throw new Error("Restore verification database name must start with policy_restore_verify_.");
  return { hostname: value.hostname, port: value.port, database };
}
function resolveBackupDirectory(manifestPath, manifest) {
  const parent = path.dirname(manifestPath);
  if (path.basename(parent) === manifest.backupId) return parent;
  return path.join(parent, manifest.backupId);
}
function runPsql(psqlPath, targetUrl, args, capture = false) {
  const result = spawnSync(psqlPath, [targetUrl, ...args], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "pipe"]
  });
  if (result.status !== 0) throw new Error(redact(`${result.stderr ?? ""}\npsql exited with ${result.status}`));
  return capture ? String(result.stdout ?? "") : "";
}
function findExecutable(name) {
  const command = process.platform === "win32" ? "where.exe" : "sh";
  const args = process.platform === "win32" ? [name] : ["-lc", `command -v ${name}`];
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? String(result.stdout ?? "").trim().split(/\r?\n/)[0] : null;
}
function verifySqlStructure(kind, text) {
  if (kind === "roles") return /CREATE ROLE|ALTER ROLE|Roles/i.test(text);
  if (kind === "schema") return /CREATE TABLE|CREATE SCHEMA|CREATE FUNCTION/i.test(text);
  if (kind === "data") return /COPY |INSERT INTO/i.test(text);
  return false;
}
function redact(value) {
  return String(value ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]").slice(0, 10_000);
}
async function readJsonIfExists(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
async function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
