#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
await loadEnvFiles([".env.local", ".env"]);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_FUNCTION_JWT || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const crawlerSecret = process.env.SUPABASE_CRAWLER_SECRET;
if (!supabaseUrl || (!accessToken && !crawlerSecret)) {
  throw new Error("Read-only source export requires SUPABASE_URL and an accepted admin/crawler credential.");
}

const registry = JSON.parse(await fs.readFile(path.resolve(args.registry), "utf8"));
if (!Array.isArray(registry.reports)) {
  throw new Error("Governance registry must contain a reports array.");
}

const documents = [];
for (const [index, item] of registry.reports.entries()) {
  const policyId = String(item.policyId ?? "").trim();
  if (!policyId) throw new Error(`Registry item ${index + 1} is missing policyId.`);
  const result = await callAnalyze({
    getManualAnalysisPolicy: true,
    policyId
  });
  const policy = result?.policy;
  if (!policy || typeof policy !== "object") {
    throw new Error(`Policy ${policyId} did not return a source document.`);
  }
  const fullText = typeof policy.fullText === "string" ? policy.fullText.trim() : "";
  if (fullText.length < 280) {
    throw new Error(`Policy ${policyId} returned source text shorter than 280 characters.`);
  }

  documents.push({
    policyId,
    sourceUrl: typeof policy.sourceUrl === "string" ? policy.sourceUrl : null,
    fullText,
    fetchedAt: null,
    officialPublishedAt: typeof policy.publishDate === "string" ? `${policy.publishDate}T00:00:00+08:00` : null,
    parserVersion: "source-segmenter-v1",
    metadata: {
      title: policy.title ?? item.title ?? null,
      issuer: policy.issuer ?? null,
      sourceName: policy.sourceName ?? null,
      exportMethod: "analyze.getManualAnalysisPolicy",
      verificationStatus: "production_export_pending_official_crosscheck",
      sourceOrigin: "production_database",
      exportedAt: new Date().toISOString()
    }
  });
  console.log(`[stage7:source-export] ${index + 1}/${registry.reports.length} ${policyId}`);
}

const output = {
  formatVersion: "stage7-source-export-v1",
  exportedAt: new Date().toISOString(),
  count: documents.length,
  documents
};
await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
await fs.writeFile(path.resolve(args.out), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[stage7:source-export] wrote ${documents.length} source documents to ${path.resolve(args.out)}`);

async function callAnalyze(body) {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/analyze`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(crawlerSecret ? { "x-crawler-secret": crawlerSecret } : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Source export failed for ${body.policyId}: ${response.status} ${JSON.stringify(result)}`);
  }
  return result;
}

function parseArgs(argv) {
  const parsed = {
    registry: "docs/manual-analysis/report-governance-registry-v1.0.json",
    out: "artifacts/stage7/source-documents.json"
  };
  for (const arg of argv) {
    if (arg.startsWith("--registry=")) parsed.registry = arg.slice("--registry=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/export-stage7-source-documents.mjs [--registry=<path>] [--out=<path>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function loadEnvFiles(files) {
  for (const file of files) {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
}
