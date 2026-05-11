#!/usr/bin/env node

const DEFAULT_LIMIT = 30;

const args = parseArgs(process.argv.slice(2));
const limit = Math.max(1, Number(args.limit ?? DEFAULT_LIMIT));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_FUNCTION_JWT;
const crawlerSecret = process.env.SUPABASE_CRAWLER_SECRET;

if (!supabaseUrl || (!accessToken && !crawlerSecret)) {
  throw new Error("Requires SUPABASE_URL and either SUPABASE_FUNCTION_JWT/SUPABASE_ACCESS_TOKEN or SUPABASE_CRAWLER_SECRET.");
}

const result = await callAnalyzeBatch(limit);
const selected = Number(result.selected ?? 0);
const reanalyzed = Number(result.reanalyzed ?? 0);
const skipped = Number(result.skipped ?? 0);
const failed = Number(result.failed ?? 0);

console.log(`[reanalyze] selected=${selected} limit=${limit}`);
console.log(`[reanalyze] reanalyzed=${reanalyzed} skipped=${skipped} failed=${failed}`);

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

async function callAnalyzeBatch(maxRows) {
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
      limit: maxRows,
      reanalysisReason: "refresh-published-report-payload"
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`analyze failed: ${response.status} ${JSON.stringify(result)}`);
  }

  return result;
}
