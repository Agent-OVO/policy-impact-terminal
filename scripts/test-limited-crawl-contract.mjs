#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const [crawler, workflow, packageJson, ingest] = await Promise.all([
  fs.readFile(new URL("./crawl-policy-sources.mjs", import.meta.url), "utf8"),
  fs.readFile(new URL("../.github/workflows/crawl-policies.yml", import.meta.url), "utf8"),
  fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../supabase/functions/ingest/index.ts", import.meta.url), "utf8")
]);

assert.match(crawler, /--manual-selection-only/);
assert.match(crawler, /automaticAnalysisSelection/);
assert.match(crawler, /analysisQueueSelected/);
assert.match(crawler, /manualReviewDisposition/);
assert.match(crawler, /buildLimitedPolicyPlan/);
assert.match(crawler, /DEFAULT_CANDIDATE_LIMIT = 24/);
assert.match(crawler, /DEFAULT_INGEST_LIMIT = 24/);

assert.match(workflow, /cron: "17 \* \* \* \*"/);
assert.match(workflow, /--manual-selection-only/);
assert.match(workflow, /policy:triage-test/);
assert.match(workflow, /policy:crawl-contract-test/);
assert.match(workflow, /policy:hourly-operations-test/);
assert.doesNotMatch(workflow, /--auto-select-analysis/);

assert.match(ingest, /if \(!analysisQueueSelected\)/);
assert.match(ingest, /job: null/);
assert.match(ingest, /manualReviewDisposition/);
assert.match(ingest, /analysisQueueSelected: false/);

const scripts = JSON.parse(packageJson).scripts;
assert.equal(scripts["operation:collect-hourly"], "node scripts/crawl-policy-sources.mjs --manual-selection-only");
assert.ok(scripts["policy:operations-test"]);

console.log("[policy:crawl-contract-test] hourly schedule, bounded collection, and manual analysis contract passed");
