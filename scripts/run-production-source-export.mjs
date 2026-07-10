#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const expectedUrl = `https://${args.projectRef}.supabase.co`;
const configuredUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || expectedUrl).replace(/\/$/, "");

if (configuredUrl !== expectedUrl) {
  throw new Error(`Supabase URL mismatch: expected ${expectedUrl}, received ${configuredUrl}.`);
}

const outputPath = assertSafeOutput(args.out);
if (!args.apply) {
  console.log(`[production:source-export] validation only project=${args.projectRef}`);
  console.log("[production:source-export] no production request was sent; pass --apply-readonly-export with transient credentials after review");
  process.exit(0);
}

const expectedConfirmation = `READ_ONLY_SOURCE_EXPORT:${args.projectRef}`;
if (process.env.SOURCE_EXPORT_CONFIRMATION !== expectedConfirmation) {
  throw new Error(`Set SOURCE_EXPORT_CONFIRMATION=${expectedConfirmation} for this read-only export.`);
}

const credentialNames = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_FUNCTION_JWT",
  "SUPABASE_CRAWLER_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY"
].filter((name) => Boolean(process.env[name]));
if (credentialNames.length === 0) {
  throw new Error("A transient accepted admin/crawler credential is required for the read-only source export.");
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const childArgs = [
  path.resolve("scripts/export-stage7-source-documents.mjs"),
  `--registry=${path.resolve(args.registry)}`,
  `--out=${outputPath}`
];
const { stdout, stderr } = await execFileAsync(process.execPath, childArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SUPABASE_URL: expectedUrl
  },
  timeout: 300_000,
  maxBuffer: 8 * 1024 * 1024,
  windowsHide: true
});
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(redact(stderr));

const exported = JSON.parse(await fs.readFile(outputPath, "utf8"));
if (!Array.isArray(exported.documents) || exported.documents.length !== 20 || exported.count !== 20) {
  throw new Error(`Production source export expected 20 documents, received ${exported.documents?.length ?? 0}.`);
}
const ids = new Set();
for (const document of exported.documents) {
  if (typeof document.policyId !== "string" || !document.policyId) {
    throw new Error("Production source export contains a document without policyId.");
  }
  if (ids.has(document.policyId)) throw new Error(`Duplicate production policyId: ${document.policyId}`);
  ids.add(document.policyId);
  if (typeof document.fullText !== "string" || document.fullText.trim().length < 280) {
    throw new Error(`Production source ${document.policyId} is missing usable full_text.`);
  }
}

console.log(`[production:source-export] verified ${exported.documents.length}/20 production source documents`);
console.log(`[production:source-export] wrote ${outputPath}`);

function parseArgs(argv) {
  const parsed = {
    projectRef: "qxzspsofhmfjceuaulhu",
    registry: "docs/manual-analysis/report-governance-registry-v1.0.json",
    out: "artifacts/stage7/production-source-documents.json",
    apply: false
  };
  for (const arg of argv) {
    if (arg.startsWith("--project-ref=")) parsed.projectRef = arg.slice("--project-ref=".length);
    else if (arg.startsWith("--registry=")) parsed.registry = arg.slice("--registry=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg === "--apply-readonly-export") parsed.apply = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/run-production-source-export.mjs [--apply-readonly-export] [--project-ref=<ref>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function assertSafeOutput(value) {
  const resolved = path.resolve(value);
  const allowedRoot = path.resolve("artifacts/stage7");
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`Production source output must stay under ${allowedRoot}.`);
  }
  return resolved;
}

function redact(value) {
  let output = String(value ?? "");
  for (const name of [
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_FUNCTION_JWT",
    "SUPABASE_CRAWLER_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY"
  ]) {
    const secret = process.env[name];
    if (secret) output = output.split(secret).join("[redacted]");
  }
  return output.replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]");
}
