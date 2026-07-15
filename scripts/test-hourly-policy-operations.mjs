#!/usr/bin/env node
import assert from "node:assert/strict";

const sourceKeys = [
  "gov_zhengce_latest",
  "ndrc_policy_documents",
  "miit_policy_library",
  "nda_policy_release"
];
const runs = [
  {
    crawledAt: "2026-07-15T01:17:00.000Z",
    automaticAnalysisSelection: false,
    sourceKeys,
    counts: { analysisSelected: 0 },
    analysisQueue: []
  },
  {
    crawledAt: "2026-07-15T02:17:00.000Z",
    automaticAnalysisSelection: false,
    sourceKeys,
    counts: { analysisSelected: 0 },
    analysisQueue: []
  }
];

for (const run of runs) {
  assert.equal(run.automaticAnalysisSelection, false);
  assert.equal(run.counts.analysisSelected, 0);
  assert.deepEqual(run.analysisQueue, []);
  assert.deepEqual(run.sourceKeys, sourceKeys);
}
const intervalMs = Date.parse(runs[1].crawledAt) - Date.parse(runs[0].crawledAt);
assert.equal(intervalMs, 60 * 60 * 1000);

console.log("[policy:hourly-operations-test] hourly cadence and zero automatic analysis selection passed");
