#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const generatedAt = new Date().toISOString();

const projects = await runSupabaseJson(["projects", "list", "--output", "json"]);
const projectRows = Array.isArray(projects) ? projects : [];
const project = projectRows.find((item) => item?.ref === args.projectRef || item?.id === args.projectRef) ?? null;
const backups = await runSupabaseJson([
  "backups",
  "list",
  "--project-ref",
  args.projectRef,
  "--output",
  "json"
]);
const branches = await runSupabaseJson([
  "branches",
  "list",
  "--project-ref",
  args.projectRef,
  "--output",
  "json"
]).catch((error) => ({ error: sanitizeError(error) }));

const shadowPackage = await readJsonIfExists(args.shadowPackage);
const productionSourceSnapshot = await readJsonIfExists(args.productionSourceSnapshot);
const sourceCrosscheck = await readJsonIfExists(args.sourceCrosscheck);
const logicalBackupManifest = await readJsonIfExists(args.logicalBackupManifest);
const localMigrationFiles = await listMigrationFiles(args.migrationsDir);
const credentialNames = collectCredentialNames();

const backupRows = Array.isArray(backups?.backups) ? backups.backups : [];
const hasRestorablePhysicalBackup = backupRows.length > 0;
const pitrEnabled = backups?.pitr_enabled === true;
const logicalBackupValid = Boolean(
  logicalBackupManifest?.formatVersion === "zero-cost-logical-backup-v1" &&
  logicalBackupManifest?.projectRef === args.projectRef &&
  logicalBackupManifest?.readOnlyExport === true &&
  logicalBackupManifest?.additionalPaidResourcesCreated === false &&
  logicalBackupManifest?.cryptographicSelfCheckPassed === true &&
  logicalBackupManifest?.restoreVerified === true &&
  Array.isArray(logicalBackupManifest?.files) &&
  logicalBackupManifest.files.length >= 3
);
const backupGatePassed = hasRestorablePhysicalBackup || pitrEnabled || logicalBackupValid;
const shadowReady = shadowPackage?.deploymentReady === true && shadowPackage?.counts?.reports === 20;
const productionSourcesAvailable = Boolean(
  productionSourceSnapshot &&
  (Array.isArray(productionSourceSnapshot.documents) || Array.isArray(productionSourceSnapshot))
);
const sourceCrosscheckPassed = sourceCrosscheck?.summary?.divergent === 0 || sourceCrosscheck?.exact === 20;
const hasDatabaseConnectionCredential = credentialNames.some((name) => [
  "SUPABASE_DB_PASSWORD",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "PGPASSWORD"
].includes(name));
const hasReadOnlyApplicationCredential = credentialNames.some((name) => [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_FUNCTION_JWT",
  "SUPABASE_CRAWLER_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY"
].includes(name));

const blockers = [];
if (!project) blockers.push("target_project_not_found");
if (project && project.status !== "ACTIVE_HEALTHY") blockers.push("target_project_not_healthy");
if (!shadowReady) blockers.push("deployment_ready_shadow_package_missing");
if (!backupGatePassed) blockers.push("no_confirmed_restorable_backup_or_pitr");
if (!productionSourcesAvailable) blockers.push("production_source_snapshot_missing");
if (!sourceCrosscheckPassed) blockers.push("production_source_crosscheck_not_passed");
if (!hasDatabaseConnectionCredential) blockers.push("database_connection_credential_missing");

const report = {
  formatVersion: "zero-cost-production-readiness-v1",
  generatedAt,
  projectRef: args.projectRef,
  costPolicy: {
    additionalPaidResourcesAllowed: false,
    previewBranchCreationAllowed: false,
    newPaidProjectAllowed: false,
    auditPerformedReadOnly: true
  },
  project: project
    ? {
        ref: project.ref,
        name: project.name,
        linked: project.linked === true,
        status: project.status,
        region: project.region,
        postgresEngine: project.database?.postgres_engine ?? null,
        postgresVersion: project.database?.version ?? null,
        host: project.database?.host ?? null
      }
    : null,
  branches: normalizeBranches(branches),
  backup: {
    pitrEnabled,
    walgEnabled: backups?.walg_enabled === true,
    region: backups?.region ?? null,
    physicalBackupCount: backupRows.length,
    hasRestorablePhysicalBackup,
    logicalBackupManifestPath: path.resolve(args.logicalBackupManifest),
    logicalBackupPresent: Boolean(logicalBackupManifest),
    logicalBackupRestoreVerified: logicalBackupManifest?.restoreVerified === true,
    logicalBackupValid,
    backupGatePassed
  },
  repository: {
    localMigrationCount: localMigrationFiles.length,
    localMigrations: localMigrationFiles,
    shadowPackagePath: path.resolve(args.shadowPackage),
    shadowReady,
    shadowCounts: shadowPackage?.counts ?? null,
    productionSourceSnapshotPath: path.resolve(args.productionSourceSnapshot),
    productionSourcesAvailable,
    sourceCrosscheckPath: path.resolve(args.sourceCrosscheck),
    sourceCrosscheckPassed
  },
  credentials: {
    detectedNames: credentialNames,
    hasDatabaseConnectionCredential,
    hasReadOnlyApplicationCredential,
    valuesCaptured: false
  },
  productionWriteReady: blockers.length === 0,
  blockers,
  nextSafeActions: buildNextSafeActions({
    shadowReady,
    backupGatePassed,
    productionSourcesAvailable,
    sourceCrosscheckPassed,
    hasDatabaseConnectionCredential,
    hasReadOnlyApplicationCredential
  })
};

await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
await fs.writeFile(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`[production:readiness] project=${project?.status ?? "not_found"}`);
console.log(`[production:readiness] backupGatePassed=${backupGatePassed} pitr=${pitrEnabled} physicalBackups=${backupRows.length}`);
console.log(`[production:readiness] shadowReady=${shadowReady} productionSources=${productionSourcesAvailable} crosscheck=${sourceCrosscheckPassed}`);
console.log(`[production:readiness] productionWriteReady=${report.productionWriteReady}`);
console.log(`[production:readiness] blockers=${blockers.join(",") || "none"}`);
console.log(`[production:readiness] wrote ${path.resolve(args.out)}`);

if (args.requireWriteReady && !report.productionWriteReady) {
  process.exitCode = 2;
}

function parseArgs(argv) {
  const parsed = {
    projectRef: "qxzspsofhmfjceuaulhu",
    shadowPackage: "artifacts/stage7/report-revision-shadow.json",
    productionSourceSnapshot: "artifacts/stage7/production-source-documents.json",
    sourceCrosscheck: "artifacts/stage7/source-crosscheck.json",
    logicalBackupManifest: "artifacts/production-backups/latest-manifest.json",
    migrationsDir: "supabase/migrations",
    out: "artifacts/stage8/zero-cost-production-readiness.json",
    requireWriteReady: false
  };
  for (const arg of argv) {
    if (arg.startsWith("--project-ref=")) parsed.projectRef = arg.slice("--project-ref=".length);
    else if (arg.startsWith("--shadow-package=")) parsed.shadowPackage = arg.slice("--shadow-package=".length);
    else if (arg.startsWith("--production-source-snapshot=")) parsed.productionSourceSnapshot = arg.slice("--production-source-snapshot=".length);
    else if (arg.startsWith("--source-crosscheck=")) parsed.sourceCrosscheck = arg.slice("--source-crosscheck=".length);
    else if (arg.startsWith("--logical-backup-manifest=")) parsed.logicalBackupManifest = arg.slice("--logical-backup-manifest=".length);
    else if (arg.startsWith("--migrations-dir=")) parsed.migrationsDir = arg.slice("--migrations-dir=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg === "--require-write-ready") parsed.requireWriteReady = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/audit-zero-cost-production-readiness.mjs [--project-ref=<ref>] [--require-write-ready]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function runSupabaseJson(commandArgs) {
  const invocation = process.platform === "win32"
    ? {
        command: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", ["npx", "--yes", "supabase@2.109.1", ...commandArgs].map(quoteWindowsArgument).join(" ")]
      }
    : {
        command: "npx",
        args: ["--yes", "supabase@2.109.1", ...commandArgs]
      };
  const { stdout } = await execFileAsync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true
  });
  return JSON.parse(stdout);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function listMigrationFiles(directory) {
  const entries = await fs.readdir(path.resolve(directory));
  return entries.filter((item) => item.endsWith(".sql")).sort();
}

function collectCredentialNames() {
  const names = new Set();
  for (const name of Object.keys(process.env)) {
    if (/^(SUPABASE|VITE_SUPABASE|DATABASE_URL|PGPASSWORD)/.test(name)) names.add(name);
  }
  return [...names].sort();
}

function normalizeBranches(value) {
  if (Array.isArray(value)) {
    return {
      available: true,
      count: value.length,
      branches: value.map((item) => ({
        id: item.id ?? null,
        name: item.name ?? null,
        status: item.status ?? null,
        isDefault: item.is_default === true
      }))
    };
  }
  return {
    available: false,
    count: 0,
    branches: [],
    error: value?.error ?? null
  };
}

function buildNextSafeActions(state) {
  const actions = [];
  if (!state.shadowReady) actions.push("rebuild_and_validate_local_shadow_package");
  if (!state.hasReadOnlyApplicationCredential) actions.push("provide_ephemeral_admin_or_crawler_credential_for_read_only_source_export");
  if (!state.productionSourcesAvailable) actions.push("export_production_full_text_read_only");
  if (!state.sourceCrosscheckPassed) actions.push("run_production_official_source_crosscheck");
  if (!state.backupGatePassed) actions.push("establish_zero_cost_logical_backup_and_restore_check_before_any_write");
  if (!state.hasDatabaseConnectionCredential) actions.push("provide_ephemeral_database_connection_credential_only_when_backup_or_migration_is_authorized");
  return actions;
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]").slice(0, 500);
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
