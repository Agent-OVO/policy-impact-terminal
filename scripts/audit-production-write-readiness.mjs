#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const manifestPath = path.resolve(args.manifest);
const backups = runSupabaseJson(["backups", "list", "--project-ref", args.projectRef, "--output", "json"]);
const manifest = await readJsonIfExists(manifestPath);
const backupRows = Array.isArray(backups?.backups) ? backups.backups : [];
const logicalBackupValid = Boolean(
  manifest?.formatVersion === "zero-cost-logical-backup-v1" &&
  manifest?.projectRef === args.projectRef &&
  manifest?.readOnlyExport === true &&
  manifest?.additionalPaidResourcesCreated === false &&
  manifest?.cryptographicSelfCheckPassed === true &&
  manifest?.restoreVerified === true &&
  Array.isArray(manifest?.files) &&
  manifest.files.length >= 3
);
const physicalBackupAvailable = backupRows.length > 0;
const pitrEnabled = backups?.pitr_enabled === true;
const backupGatePassed = physicalBackupAvailable || pitrEnabled || logicalBackupValid;
const detectedCredentialNames = Object.keys(process.env)
  .filter((name) => ["SUPABASE_DB_PASSWORD", "DATABASE_URL", "SUPABASE_DB_URL", "PGPASSWORD"].includes(name))
  .sort();
const databaseCredentialAvailable = detectedCredentialNames.length > 0;
const blockers = [];
if (!backupGatePassed) blockers.push("no_confirmed_restorable_backup_or_pitr");
if (!databaseCredentialAvailable) blockers.push("database_connection_credential_missing");

const report = {
  formatVersion: "production-write-readiness-v1",
  generatedAt: new Date().toISOString(),
  projectRef: args.projectRef,
  readOnlyAudit: true,
  backup: {
    pitrEnabled,
    walgEnabled: backups?.walg_enabled === true,
    physicalBackupCount: backupRows.length,
    physicalBackupAvailable,
    logicalBackupManifest: manifestPath,
    logicalBackupPresent: Boolean(manifest),
    logicalBackupRestoreVerified: manifest?.restoreVerified === true,
    logicalBackupValid,
    backupGatePassed
  },
  credentials: {
    detectedNames: detectedCredentialNames,
    databaseCredentialAvailable,
    valuesCaptured: false
  },
  productionWriteReady: blockers.length === 0,
  blockers,
  requiredNextActions: [
    ...(!backupGatePassed ? ["create_encrypted_logical_backup_and_verify_local_restore"] : []),
    ...(!databaseCredentialAvailable ? ["provide_transient_database_credential_only_for_authorized_backup_or_migration"] : [])
  ]
};

await writeJson(args.out, report);
console.log(`[production:write-readiness] backupGatePassed=${backupGatePassed} pitr=${pitrEnabled} physical=${backupRows.length} logical=${logicalBackupValid}`);
console.log(`[production:write-readiness] databaseCredentialAvailable=${databaseCredentialAvailable}`);
console.log(`[production:write-readiness] productionWriteReady=${report.productionWriteReady}`);
console.log(`[production:write-readiness] blockers=${blockers.join(",") || "none"}`);
console.log(`[production:write-readiness] wrote ${path.resolve(args.out)}`);
if (args.requireWriteReady && !report.productionWriteReady) process.exitCode = 2;

function parseArgs(argv) {
  const parsed = {
    projectRef: "qxzspsofhmfjceuaulhu",
    manifest: "artifacts/production-backups/latest-manifest.json",
    out: "artifacts/production-write-readiness.json",
    requireWriteReady: false
  };
  for (const arg of argv) {
    if (arg.startsWith("--project-ref=")) parsed.projectRef = arg.slice("--project-ref=".length);
    else if (arg.startsWith("--manifest=")) parsed.manifest = arg.slice("--manifest=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg === "--require-write-ready") parsed.requireWriteReady = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/audit-production-write-readiness.mjs [--project-ref=<ref>] [--require-write-ready]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function runSupabaseJson(commandArgs) {
  const invocation = process.platform === "win32"
    ? {
        command: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", ["npx", "supabase", ...commandArgs].map(quoteWindowsArgument).join(" ")]
      }
    : { command: "npx", args: ["supabase", ...commandArgs] };
  try {
    const stdout = execFileSync(invocation.command, invocation.args, {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], timeout: 180_000, maxBuffer: 8 * 1024 * 1024
    });
    return parseJsonPayload(stdout);
  } catch (error) {
    const stdout = error?.stdout?.toString?.() ?? "";
    const recovered = parseJsonPayload(stdout, false);
    if (recovered !== null) return recovered;
    throw new Error(sanitize(`${error?.stderr ?? ""}\n${error?.message ?? "Supabase command failed"}`));
  }
}

function parseJsonPayload(value, throwOnFailure = true) {
  const text = String(value ?? "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch { /* continue */ }
  }
  if (throwOnFailure) throw new Error("Supabase command did not return JSON.");
  return null;
}
function quoteWindowsArgument(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
function sanitize(value) {
  return String(value ?? "").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]").slice(0, 2_000);
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
