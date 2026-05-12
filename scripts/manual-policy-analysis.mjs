#!/usr/bin/env node

import fs from "node:fs/promises";

const DEFAULT_LIMIT = 10;
const DEFAULT_SINCE = "2026-05-01";

const args = parseArgs(process.argv.slice(2));
await loadEnvFiles([".env.local", ".env"]);

const command = args._[0] ?? "list";
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_FUNCTION_JWT || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const crawlerSecret = process.env.SUPABASE_CRAWLER_SECRET;

if (!supabaseUrl || (!accessToken && !crawlerSecret)) {
  throw new Error("Requires SUPABASE_URL and either SUPABASE_FUNCTION_JWT/SUPABASE_ACCESS_TOKEN or SUPABASE_CRAWLER_SECRET.");
}

if (command === "list") {
  const result = await callAnalyze({
    listPendingManualAnalysis: true,
    limit: Number(args.limit ?? DEFAULT_LIMIT),
    sincePublishDate: args.since ?? DEFAULT_SINCE
  });
  console.log(JSON.stringify(result, null, 2));
} else if (command === "get") {
  const policyId = args.policyId ?? args.id;
  if (!policyId) throw new Error("Usage: node scripts/manual-policy-analysis.mjs get --policyId=<uuid>");

  const result = await callAnalyze({
    getManualAnalysisPolicy: true,
    policyId
  });
  console.log(JSON.stringify(result, null, 2));
} else if (command === "apply") {
  const policyId = args.policyId ?? args.id;
  const file = args.file;
  if (!policyId || !file) {
    throw new Error("Usage: node scripts/manual-policy-analysis.mjs apply --policyId=<uuid> --file=<report-payload.json>");
  }

  const reportPayload = JSON.parse(await fs.readFile(file, "utf8"));
  const result = await callAnalyze({
    applyManualAnalysis: true,
    policyId,
    reportPayload
  });
  console.log(JSON.stringify({
    policyId: result.policyId,
    analyzerVersion: result.analyzerVersion,
    published: result.published
  }, null, 2));
} else {
  throw new Error(`Unknown command: ${command}. Use list, get, or apply.`);
}

function parseArgs(values) {
  const parsed = { _: [] };
  for (const value of values) {
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }
    const [key, raw = "true"] = value.slice(2).split("=");
    parsed[key] = raw;
  }
  return parsed;
}

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
    throw new Error(`analyze failed: ${response.status} ${JSON.stringify(result)}`);
  }

  return result;
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
