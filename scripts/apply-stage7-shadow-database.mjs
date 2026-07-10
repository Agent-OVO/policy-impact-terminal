#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyStage7ShadowPackage } from "./lib/stage7-shadow-database-loader.mjs";

const args = parseArgs(process.argv.slice(2));
const shadowPath = path.resolve(args.shadowPackage);
const shadow = JSON.parse(await fs.readFile(shadowPath, "utf8"));
validateShadow(shadow, args);

if (!args.apply) {
  console.log(`[stage7:db-load] validation only target=${args.target} reports=${shadow.counts?.reports ?? shadow.revisions.length}`);
  console.log(`[stage7:db-load] deploymentReady=${shadow.deploymentReady} shadow=${shadowPath}`);
  console.log("[stage7:db-load] no database connection was opened; pass --apply with the required confirmation only after staging/backup gates are complete");
  process.exit(0);
}

const databaseUrl = process.env.STAGE7_DATABASE_URL?.trim();
const pgModulePath = process.env.PG_MODULE_PATH?.trim();
if (!databaseUrl) throw new Error("STAGE7_DATABASE_URL is required for --apply.");
if (!pgModulePath) throw new Error("PG_MODULE_PATH is required for --apply; use run-stage7-shadow-database-load.mjs.");
const parsedUrl = new URL(databaseUrl);
validateRemoteTarget(parsedUrl, args);

const pgModule = await import(pathToFileURL(path.resolve(pgModulePath)).href);
const Client = pgModule.Client ?? pgModule.default?.Client;
if (!Client) throw new Error("Could not load pg.Client from PG_MODULE_PATH.");
const client = new Client({
  connectionString: databaseUrl,
  ssl: isLocalHost(parsedUrl.hostname) ? false : { rejectUnauthorized: false },
  application_name: `policy-impact-terminal-stage7-${args.target}`
});

try {
  await client.connect();
  const database = {
    query: (sql, params) => client.query(sql, params),
    exec: (sql) => client.query(sql)
  };
  await assertRemotePreflight(database, shadow, args);
  const result = await applyStage7ShadowPackage(database, shadow, {
    actorId: args.actorId,
    seedMissingPolicies: args.seedMissingPolicies
  });
  await assertRemotePostflight(database, shadow);
  console.log(`[stage7:db-load] applied target=${args.target} policies=${result.policies} revisions=${result.revisions}`);
  console.log(`[stage7:db-load] projections actions=${result.policyActions} nodes=${result.industryNodes} companies=${result.companyRelations} evidence=${result.evidenceRefs}`);
} finally {
  await client.end().catch(() => undefined);
}

function validateShadow(shadowPackage, inputArgs) {
  if (shadowPackage.deploymentReady !== true) throw new Error("Shadow package must have deploymentReady=true.");
  if (!Array.isArray(shadowPackage.revisions) || !Array.isArray(shadowPackage.sourceDocuments)) {
    throw new Error("Invalid Stage 7 shadow package.");
  }
  if (!isUuid(inputArgs.actorId)) throw new Error("--actor-id must be a UUID.");
  const expectedConfirmation = inputArgs.target === "production"
    ? "APPLY_STAGE7_PRODUCTION"
    : "APPLY_STAGE7_STAGING";
  if (inputArgs.apply && inputArgs.confirm !== expectedConfirmation) {
    throw new Error(`--apply requires --confirm=${expectedConfirmation}.`);
  }
  if (inputArgs.seedMissingPolicies && inputArgs.target !== "staging") {
    throw new Error("--seed-missing-policies is allowed only for staging targets.");
  }
  if (inputArgs.target === "production" && inputArgs.apply && !process.env.STAGE7_BACKUP_REFERENCE?.trim()) {
    throw new Error("Production apply requires STAGE7_BACKUP_REFERENCE identifying a verified backup/restore point.");
  }
}

function validateRemoteTarget(url, inputArgs) {
  if (!isLocalHost(url.hostname) && url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Remote database URL must use postgres:// or postgresql://.");
  }
  if (inputArgs.expectedHost && url.hostname.toLowerCase() !== inputArgs.expectedHost.toLowerCase()) {
    throw new Error(`Database host mismatch; expected ${inputArgs.expectedHost}.`);
  }
  if (!isLocalHost(url.hostname) && !inputArgs.expectedHost) {
    throw new Error("Remote apply requires --expected-host to prevent accidental writes to the wrong project.");
  }
}

async function assertRemotePreflight(database, shadowPackage, inputArgs) {
  const migration = await database.query(
    `select to_regclass('public.report_revisions')::text as report_revisions,
            to_regclass('public.policy_source_documents')::text as source_documents`
  );
  if (!migration.rows[0]?.report_revisions || !migration.rows[0]?.source_documents) {
    throw new Error("Stage 7 schema migration is not applied on the target database.");
  }
  const actor = await database.query(
    `select role, status from public.profiles where id=$1::uuid`,
    [inputArgs.actorId]
  );
  if (actor.rows.length !== 1 || actor.rows[0].role !== "admin" || actor.rows[0].status !== "active") {
    throw new Error("Migration actor must be an active admin profile on the target database.");
  }
  const policyIds = shadowPackage.revisions.map((item) => item.policyId);
  const policies = await database.query(
    `select count(*)::int as count from public.policies where id=any($1::uuid[])`,
    [policyIds]
  );
  if (policies.rows[0].count !== policyIds.length && !inputArgs.seedMissingPolicies) {
    throw new Error(`Target database contains ${policies.rows[0].count}/${policyIds.length} required policies.`);
  }
  if (policies.rows[0].count !== policyIds.length && inputArgs.target !== "staging") {
    throw new Error("Missing policies can only be seeded into a staging target.");
  }
  if (inputArgs.target === "production") {
    const current = await database.query(
      `select count(*)::int as count from public.policies where current_published_revision_id is not null`
    );
    if (current.rows[0].count > 0 && !inputArgs.allowIdempotentProduction) {
      throw new Error("Production already contains Stage 7 revision pointers; use --allow-idempotent-production only for a verified rerun.");
    }
  }
}

async function assertRemotePostflight(database, shadowPackage) {
  const policyIds = shadowPackage.revisions.map((item) => item.policyId);
  const result = await database.query(
    `select count(*)::int as count
     from public.policies p
     join public.report_revisions r on r.id=p.current_published_revision_id
     join public.policy_source_documents d on d.id=p.current_source_document_id
     where p.id=any($1::uuid[])
       and r.status='published'
       and r.source_document_hash=d.source_document_hash
       and r.projection_hash is not null`,
    [policyIds]
  );
  if (result.rows[0].count !== policyIds.length) {
    throw new Error(`Postflight pointer/hash verification failed: ${result.rows[0].count}/${policyIds.length}.`);
  }
}

function parseArgs(argv) {
  const parsed = {
    shadowPackage: "artifacts/stage7/report-revision-shadow.json",
    actorId: "",
    target: "staging",
    apply: false,
    confirm: "",
    expectedHost: "",
    allowIdempotentProduction: false,
    seedMissingPolicies: false
  };
  for (const arg of argv) {
    if (arg.startsWith("--shadow-package=")) parsed.shadowPackage = arg.slice("--shadow-package=".length);
    else if (arg.startsWith("--actor-id=")) parsed.actorId = arg.slice("--actor-id=".length);
    else if (arg.startsWith("--target=")) parsed.target = arg.slice("--target=".length);
    else if (arg === "--apply") parsed.apply = true;
    else if (arg.startsWith("--confirm=")) parsed.confirm = arg.slice("--confirm=".length);
    else if (arg.startsWith("--expected-host=")) parsed.expectedHost = arg.slice("--expected-host=".length);
    else if (arg === "--allow-idempotent-production") parsed.allowIdempotentProduction = true;
    else if (arg === "--seed-missing-policies") parsed.seedMissingPolicies = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["staging", "production"].includes(parsed.target)) throw new Error("--target must be staging or production.");
  return parsed;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(String(hostname).toLowerCase());
}
