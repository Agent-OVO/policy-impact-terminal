#!/usr/bin/env node

const DEFAULT_LIMIT = 30;

const args = parseArgs(process.argv.slice(2));
const limit = Math.max(1, Number(args.limit ?? DEFAULT_LIMIT));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_FUNCTION_JWT;
const crawlerSecret = process.env.SUPABASE_CRAWLER_SECRET;

if (!supabaseUrl || !anonKey || (!accessToken && !crawlerSecret)) {
  throw new Error("Requires SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and either SUPABASE_FUNCTION_JWT/SUPABASE_ACCESS_TOKEN or SUPABASE_CRAWLER_SECRET.");
}

const policies = await listPublishedPolicies(limit);
let reanalyzed = 0;
let failed = 0;

console.log(`[reanalyze] selected=${policies.length} limit=${limit}`);

for (const policy of policies) {
  try {
    await callAnalyze(policy.id);
    reanalyzed += 1;
    console.log(`[reanalyze] ok ${policy.publish_date ?? "no-date"} ${policy.title}`);
  } catch (error) {
    failed += 1;
    console.warn(`[reanalyze] failed ${policy.id} ${policy.title}: ${error.message}`);
  }
}

console.log(`[reanalyze] reanalyzed=${reanalyzed} failed=${failed}`);

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

async function listPublishedPolicies(maxRows) {
  const endpoint = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/policies`);
  endpoint.searchParams.set("select", "id,title,publish_date");
  endpoint.searchParams.set("status", "eq.published");
  endpoint.searchParams.set("order", "publish_date.desc.nullslast,created_at.desc");
  endpoint.searchParams.set("limit", String(maxRows));

  const response = await fetch(endpoint, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`
    }
  });

  const result = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(`List published policies failed: ${response.status} ${JSON.stringify(result)}`);
  }

  return Array.isArray(result) ? result : [];
}

async function callAnalyze(policyId) {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/analyze`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(crawlerSecret ? { "x-crawler-secret": crawlerSecret } : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      policyId,
      reanalysisReason: "refresh-published-report-payload"
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`analyze failed: ${response.status} ${JSON.stringify(result)}`);
  }

  return result;
}
