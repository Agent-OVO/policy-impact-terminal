#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const CONFIRMATION = "CLOSE_LEGACY_STALE_ANALYSIS_JOBS";
const DEFAULT_SINCE = "2026-05-01";
const DEFAULT_CUTOFF = "2026-07-15";
const DEFAULT_OUTPUT = "artifacts/operations/legacy-stale-job-cleanup.json";

const args = parseArgs(process.argv.slice(2));
if (args.help === "true") {
  printHelp();
  process.exit(0);
}

const apply = args.apply === "true";
const sincePublishDate = args.since ?? DEFAULT_SINCE;
const cutoffDate = args.cutoff ?? DEFAULT_CUTOFF;
const outputPath = args.output ?? DEFAULT_OUTPUT;
const expectedPolicyCount = parseOptionalNonNegativeInteger(args.expectedPolicies, "expectedPolicies");
const expectedJobCount = parseOptionalNonNegativeInteger(args.expectedJobs, "expectedJobs");

if (apply && args.input) {
  throw new Error("Apply mode must use a live inbox response; --input is dry-run only.");
}
if (apply && args.confirmation !== CONFIRMATION) {
  throw new Error(`Apply mode requires --confirmation=${CONFIRMATION}.`);
}
if (apply && (!expectedPolicyCount || !expectedJobCount)) {
  throw new Error("Apply mode requires positive --expectedPolicies and --expectedJobs values from a fresh dry run.");
}

let inbox;
let callAnalyze = null;
if (args.input) {
  inbox = JSON.parse(await fs.readFile(args.input, "utf8"));
} else {
  await loadEnvFiles([".env.local", ".env"]);
  callAnalyze = createAnalyzeClient();
  inbox = await callAnalyze({
    listPendingManualAnalysis: true,
    limit: 400,
    sincePublishDate
  });
}

const policies = Array.isArray(inbox?.policies) ? inbox.policies : [];
if (policies.some((policy) => !Number.isInteger(Number(policy?.staleOpenAnalysisJobCount ?? NaN)))) {
  throw new Error("Inbox response does not expose staleOpenAnalysisJobCount for every returned policy; deploy the stale-job visibility update first.");
}

const stalePolicies = policies.filter((policy) => Number(policy.staleOpenAnalysisJobCount) > 0);
const candidates = stalePolicies
  .filter((policy) =>
    policy.manualReviewDisposition === "pending_review" &&
    typeof policy.publishDate === "string" &&
    policy.publishDate < cutoffDate
  )
  .sort((left, right) =>
    String(left.publishDate).localeCompare(String(right.publishDate)) ||
    String(left.id).localeCompare(String(right.id))
  );
const candidateIds = new Set(candidates.map((policy) => policy.id));
const excluded = stalePolicies.filter((policy) => !candidateIds.has(policy.id));
const candidateJobCount = candidates.reduce((total, policy) => total + Number(policy.staleOpenAnalysisJobCount), 0);
const excludedJobCount = excluded.reduce((total, policy) => total + Number(policy.staleOpenAnalysisJobCount), 0);

const report = {
  formatVersion: "legacy-stale-analysis-job-cleanup-v1",
  generatedAt: new Date().toISOString(),
  mode: apply ? "apply" : "dry_run",
  authority: {
    source: args.input ? "fixture_or_saved_inbox" : "live_analyze_edge",
    sincePublishDate,
    cutoffDate,
    confirmationRequired: CONFIRMATION
  },
  guard: {
    expectedPolicyCount,
    expectedJobCount,
    actualPolicyCount: candidates.length,
    actualJobCount: candidateJobCount,
    excludedPolicyCount: excluded.length,
    excludedJobCount
  },
  candidates: candidates.map(toPolicySummary),
  excluded: excluded.map((policy) => ({
    ...toPolicySummary(policy),
    exclusionReason: exclusionReason(policy, cutoffDate)
  })),
  results: [],
  totals: {
    closedPolicies: 0,
    closedJobs: 0,
    remainingPolicies: candidates.length,
    remainingJobs: candidateJobCount
  }
};

await writeJson(outputPath, report);

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
if (excluded.length > 0) {
  throw new Error(`Refusing bulk cleanup because ${excluded.length} stale-job policies (${excludedJobCount} jobs) fall outside the pending-review pre-cutoff boundary.`);
}
if (candidates.length !== expectedPolicyCount || candidateJobCount !== expectedJobCount) {
  throw new Error(
    `Live stale-job totals changed: expected ${expectedPolicyCount} policies/${expectedJobCount} jobs, found ${candidates.length} policies/${candidateJobCount} jobs. Run a new dry run and re-confirm.`
  );
}
if (!callAnalyze) throw new Error("Live analyze client is unavailable in apply mode.");

const reason = `One-time cleanup of pre-manual-control stale analysis jobs for policies published before ${cutoffDate}; disposition remains pending_review.`;
for (const policy of candidates) {
  const expectedClosedJobs = Number(policy.staleOpenAnalysisJobCount);
  const result = await callAnalyze({
    setManualReviewDisposition: true,
    policyId: policy.id,
    disposition: "pending_review",
    reason,
    closeOpenJob: true
  });
  const actualClosedJobs = Number(result?.closedJobCount ?? NaN);
  if (actualClosedJobs !== expectedClosedJobs) {
    throw new Error(`Policy ${policy.id} expected ${expectedClosedJobs} closed jobs, got ${String(result?.closedJobCount)}.`);
  }
  report.results.push({
    policyId: policy.id,
    title: policy.title,
    publishDate: policy.publishDate,
    disposition: result.disposition,
    closedJobCount: actualClosedJobs
  });
  report.totals.closedPolicies += 1;
  report.totals.closedJobs += actualClosedJobs;
  report.totals.remainingPolicies -= 1;
  report.totals.remainingJobs -= actualClosedJobs;
  await writeJson(outputPath, report);
}

report.completedAt = new Date().toISOString();
await writeJson(outputPath, report);
console.log(JSON.stringify(report, null, 2));

function toPolicySummary(policy) {
  return {
    id: policy.id,
    title: policy.title,
    publishDate: policy.publishDate,
    manualReviewDisposition: policy.manualReviewDisposition,
    staleOpenAnalysisJobCount: Number(policy.staleOpenAnalysisJobCount),
    requiresCloseOpenJob: policy.requiresCloseOpenJob === true
  };
}

function exclusionReason(policy, cutoffDate) {
  if (policy.manualReviewDisposition !== "pending_review") {
    return `disposition=${policy.manualReviewDisposition ?? "unknown"}`;
  }
  if (typeof policy.publishDate !== "string" || policy.publishDate >= cutoffDate) {
    return `publishDate=${policy.publishDate ?? "unknown"} is not before cutoff ${cutoffDate}`;
  }
  return "outside cleanup boundary";
}

function createAnalyzeClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_FUNCTION_JWT || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const crawlerSecret = process.env.SUPABASE_CRAWLER_SECRET;
  if (!supabaseUrl || (!accessToken && !crawlerSecret)) {
    throw new Error("Requires SUPABASE_URL and either SUPABASE_FUNCTION_JWT/SUPABASE_ACCESS_TOKEN or SUPABASE_CRAWLER_SECRET.");
  }
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/analyze`;
  return async (body) => {
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
  };
}

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith("--")) throw new Error(`Unexpected positional argument: ${value}`);
    const index = value.indexOf("=");
    const key = index === -1 ? value.slice(2) : value.slice(2, index);
    const raw = index === -1 ? "true" : value.slice(index + 1);
    parsed[key] = raw;
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(value, label) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${label} must be a non-negative integer.`);
  return parsed;
}

async function writeJson(file, value) {
  const absolute = path.resolve(file);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function printHelp() {
  console.log([
    "Usage:",
    "  node scripts/cleanup-legacy-stale-analysis-jobs.mjs [--input=<inbox.json>] [--output=<report.json>]",
    `  node scripts/cleanup-legacy-stale-analysis-jobs.mjs --apply=true --confirmation=${CONFIRMATION} --expectedPolicies=<n> --expectedJobs=<n>`,
    "",
    "Safety boundary:",
    `  Only pending_review policies published before ${DEFAULT_CUTOFF} are eligible.`,
    "  Apply mode always reads the live inbox, refuses excluded stale jobs, and requires exact expected totals.",
    "  The cleanup closes open jobs but preserves pending_review disposition."
  ].join("\n"));
}
