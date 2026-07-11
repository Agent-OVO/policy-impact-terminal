#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const workflowPath = ".github/workflows/crawl-policies.yml";
const crawlerPath = "scripts/crawl-policy-sources.mjs";
const workflow = await fs.readFile(workflowPath, "utf8");
const crawler = await fs.readFile(crawlerPath, "utf8");

assert.ok(
  workflow.includes('- cron: "30 1,9 * * 1-5"'),
  "crawl workflow must run at 09:30 and 17:30 Asia/Shanghai on workdays"
);
assert.equal(
  (workflow.match(/\bcron:/g) ?? []).length,
  1,
  "crawl workflow must have exactly one bounded workday schedule"
);
for (const forbidden of [
  'cron: "0 16-23 * * 0-4"',
  'cron: "0 0-15 * * 1-5"',
  'cron: "0 16 * * 5,6"',
  'cron: "0 4 * * 6,0"',
  "default: \"80\"",
  "--limit=\"${CRAWL_LIMIT}\""
]) {
  assert.equal(workflow.includes(forbidden), false, `crawl workflow contains obsolete setting: ${forbidden}`);
}

const requiredWorkflowFragments = [
  "npm run policy:triage-test",
  "npm run policy:crawl-contract-test",
  "default: \"60\"",
  "default: \"24\"",
  "default: \"12\"",
  "default: \"3\"",
  "default: \"8\"",
  '--source-scan-limit="${SOURCE_SCAN_LIMIT}"',
  '--candidate-limit="${CANDIDATE_LIMIT}"',
  '--ingest-limit="${INGEST_LIMIT}"',
  '--analysis-limit="${ANALYSIS_LIMIT}"',
  '--pending-queue-limit="${PENDING_QUEUE_LIMIT}"'
];
for (const fragment of requiredWorkflowFragments) {
  assert.ok(workflow.includes(fragment), `crawl workflow is missing '${fragment}'`);
}

const sourceBlock = crawler.slice(0, crawler.indexOf("const args ="));
const sourceKeys = [...sourceBlock.matchAll(/\bkey:\s*"([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(sourceKeys, [
  "gov_zhengce_latest",
  "ndrc_policy_documents",
  "miit_policy_library",
  "nda_policy_release"
]);

for (const fragment of [
  "DEFAULT_SOURCE_SCAN_LIMIT = 60",
  "DEFAULT_CANDIDATE_LIMIT = 24",
  "DEFAULT_INGEST_LIMIT = 12",
  "DEFAULT_ANALYSIS_PER_RUN_LIMIT = 3",
  "DEFAULT_PENDING_QUEUE_LIMIT = 8",
  "runStatus",
  "sourceHealth",
  "analysisQueue",
  "pendingQueue",
  "Crawler run is failed because at least one selected source produced candidates but no usable full text"
]) {
  assert.ok(crawler.includes(fragment), `crawler is missing contract fragment '${fragment}'`);
}

console.log("[policy:crawl-contract-test] four-source schedule, limits, health, and queue contracts passed");
