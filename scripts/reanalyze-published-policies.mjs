#!/usr/bin/env node

const DEFAULT_LIMIT = 30;
const DEFAULT_CHUNK_SIZE = 3;

const args = parseArgs(process.argv.slice(2));
const limit = Math.max(1, Number(args.limit ?? DEFAULT_LIMIT));
let chunkSize = clampChunkSize(args.chunk ?? args.chunkSize ?? DEFAULT_CHUNK_SIZE);
const allowRulesAnalysis = args.allowRulesAnalysis === "true" || args["allow-rules-analysis"] === "true";
const sincePublishDate = String(args.since ?? args.sincePublishDate ?? args["since-publish-date"] ?? "2026-05-01");
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_FUNCTION_JWT;
const crawlerSecret = process.env.SUPABASE_CRAWLER_SECRET;

if (!allowRulesAnalysis) {
  throw new Error(
    "Published-policy rules reanalysis is disabled. Use scripts/manual-policy-analysis.mjs list/get/apply, or pass --allow-rules-analysis=true only for an explicit internal migration."
  );
}

if (!supabaseUrl || (!accessToken && !crawlerSecret)) {
  throw new Error("Requires SUPABASE_URL and either SUPABASE_FUNCTION_JWT/SUPABASE_ACCESS_TOKEN or SUPABASE_CRAWLER_SECRET.");
}

let selected = 0;
let reanalyzed = 0;
let skipped = 0;
let failed = 0;
let offset = 0;

console.log(`[reanalyze] start limit=${limit} chunk=${chunkSize}`);

while (offset < limit) {
  const currentLimit = Math.min(chunkSize, limit - offset);
  let result;

  try {
    result = await callAnalyzeBatch(currentLimit, offset);
  } catch (error) {
    if (isWorkerResourceLimit(error) && chunkSize > 1) {
      chunkSize = Math.max(1, Math.floor(chunkSize / 2));
      console.warn(`[reanalyze] worker resource limit at offset=${offset}; retrying with chunk=${chunkSize}`);
      continue;
    }
    throw error;
  }

  const batchSelected = Number(result.selected ?? 0);
  selected += batchSelected;
  reanalyzed += Number(result.reanalyzed ?? 0);
  skipped += Number(result.skipped ?? 0);
  failed += Number(result.failed ?? 0);

  console.log(`[reanalyze] batch offset=${offset} selected=${batchSelected} reanalyzed=${Number(result.reanalyzed ?? 0)} skipped=${Number(result.skipped ?? 0)} failed=${Number(result.failed ?? 0)}`);

  for (const item of Array.isArray(result.results) ? result.results : []) {
    const status = String(item.status ?? "unknown");
    const title = String(item.title ?? item.policyId ?? "untitled");
    if (status === "failed") {
      console.warn(`[reanalyze] failed ${title}: ${String(item.error ?? "unknown error")}`);
    } else if (status === "skipped") {
      console.warn(`[reanalyze] skipped ${title}: ${String(item.reason ?? "unknown reason")}`);
    } else {
      console.log(`[reanalyze] ok ${title}`);
    }
  }

  if (batchSelected === 0) {
    break;
  }

  offset += batchSelected;
}

console.log(`[reanalyze] selected=${selected} limit=${limit}`);
console.log(`[reanalyze] reanalyzed=${reanalyzed} skipped=${skipped} failed=${failed}`);

if (failed > 0) {
  process.exitCode = 1;
}

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const [key, raw = "true"] = value.slice(2).split("=");
    parsed[key] = raw;
  }
  return parsed;
}

function clampChunkSize(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_CHUNK_SIZE;
  return Math.max(1, Math.min(10, Math.floor(numericValue)));
}

function isWorkerResourceLimit(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("WORKER_RESOURCE_LIMIT") || message.includes("546");
}

async function callAnalyzeBatch(maxRows, offsetValue) {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/analyze`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(crawlerSecret ? { "x-crawler-secret": crawlerSecret } : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      reanalyzePublished: true,
      allowRulesAnalysis: true,
      limit: maxRows,
      offset: offsetValue,
      sincePublishDate,
      reanalysisReason: "refresh-published-report-payload"
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`analyze failed: ${response.status} ${JSON.stringify(result)}`);
  }

  return result;
}
