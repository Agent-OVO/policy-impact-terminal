#!/usr/bin/env node

import fs from "node:fs/promises";
import { printJson } from "./lib/json-output.mjs";

const DEFAULT_LIMIT = 10;
const DEFAULT_SINCE = "2026-05-01";

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "list";
if (command === "help" || args.help === "true") {
  printHelp();
  process.exit(0);
}
await loadEnvFiles([".env.local", ".env"]);
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
  outputJson(result);
} else if (command === "next") {
  const result = await callAnalyze({
    getNextSelectedManualAnalysis: true,
    sincePublishDate: args.since ?? DEFAULT_SINCE
  });
  outputJson(result);
} else if (command === "get") {
  const policyId = args.policyId ?? args.id;
  if (!policyId) throw new Error("Usage: node scripts/manual-policy-analysis.mjs get --policyId=<uuid>");

  const result = await callAnalyze({
    getManualAnalysisPolicy: true,
    policyId
  });
  outputJson(result);
} else if (command === "apply") {
  const policyId = args.policyId ?? args.id;
  const file = args.file;
  if (!policyId || !file) {
    throw new Error("Usage: node scripts/manual-policy-analysis.mjs apply --policyId=<uuid> --file=<report-payload.json>");
  }

  const reportPayload = JSON.parse(await fs.readFile(file, "utf8"));
  assertReportPolicyIdMatches(policyId, reportPayload, file);
  const result = await callAnalyze({
    applyManualAnalysis: true,
    policyId,
    reportPayload
  });
  outputJson({
    policyId: result.policyId,
    analyzerVersion: result.analyzerVersion,
    published: result.published,
    jobUpdated: result.jobUpdated,
    jobId: result.jobId
  });
} else if (["select", "pending", "wait", "archive", "dismiss"].includes(command)) {
  const policyId = args.policyId ?? args.id;
  if (!policyId) throw new Error(`${command} requires --policyId=<uuid>`);
  const dispositions = {
    select: "selected_for_analysis",
    pending: "pending_review",
    wait: "awaiting_evidence",
    archive: "quick_archived",
    dismiss: "dismissed"
  };
  const reason = args.reason;
  const closeOpenJob = args.closeOpenJob === "true" || args.close_open_job === "true";
  if (["wait", "archive", "dismiss"].includes(command) && (!reason || reason.length < 4)) {
    throw new Error(`${command} requires --reason=<at least 4 characters>`);
  }
  if (closeOpenJob && (!reason || reason.length < 4)) {
    throw new Error("--closeOpenJob=true requires --reason=<at least 4 characters>");
  }
  const result = await callAnalyze({
    setManualReviewDisposition: true,
    policyId,
    disposition: dispositions[command],
    reason,
    closeOpenJob
  });
  outputJson(result);
} else {
  throw new Error("Unknown command. Use list, next, get, select, pending, wait, archive, dismiss, apply, or help.");
}

function printHelp() {
  console.log(`Manual policy analysis control\n\nCommands:\n  list [--limit=10] [--since=YYYY-MM-DD]    List the review inbox.\n  next [--since=YYYY-MM-DD]                 Return the next explicitly selected policy with original text.\n  get --policyId=<uuid>                     Read one policy and its original text.\n  select --policyId=<uuid>                  Explicitly start Agent analysis and create/reuse one job.\n  pending --policyId=<uuid>                 Return a policy to pending review.\n  wait --policyId=<uuid> --reason=<text>    Wait for a named evidence item.\n  archive --policyId=<uuid> --reason=<text> Quick archive without analysis.\n  dismiss --policyId=<uuid> --reason=<text> Mark duplicate or invalid.\n  apply --policyId=<uuid> --file=<json>     Publish the Agent-reviewed analysis.\n\nControlled stale-job closure:\n  --closeOpenJob=true                       Explicitly fail all open jobs for the policy before wait/archive/dismiss; requires a reason.\n\nOutput options:\n  --asciiJson=true                          Escape non-ASCII characters for cross-platform pipes.\n  --unicodeJson=true                        Force readable Unicode output.\n\nCollection never starts analysis automatically. The user authorizes analysis; the Agent performs the research and applies the reviewed result.`);
}

function outputJson(value) {
  const asciiSafe = args.unicodeJson === "true"
    ? false
    : args.asciiJson === "true"
      ? true
      : undefined;
  printJson(value, { asciiSafe });
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

function assertReportPolicyIdMatches(policyId, reportPayload, file) {
  if (!isRecord(reportPayload)) {
    throw new Error(`Manual report ${file} must be a JSON object.`);
  }

  const policy = isRecord(reportPayload.policy) ? reportPayload.policy : {};
  const summary = isRecord(reportPayload.summary) ? reportPayload.summary : {};
  const reportIds = [
    reportPayload.policyId,
    reportPayload.policy_id,
    reportPayload.id,
    summary.id,
    policy.id,
    policy.policyId,
    policy.policy_id
  ].filter((value) => typeof value === "string" && value.trim());

  const mismatched = reportIds.filter((value) => value !== policyId);
  if (mismatched.length > 0) {
    throw new Error(
      `Manual report ${file} does not match --policyId=${policyId}; found report id(s): ${[...new Set(reportIds)].join(", ")}.`
    );
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
