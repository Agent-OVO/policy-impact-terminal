#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  auditHourlyCollectionRuns,
  candidateIdentity,
  HOURLY_POLICY_OPERATIONS_VERSION
} from "./lib/hourly-policy-operations.mjs";

const workflow = await fs.readFile(".github/workflows/crawl-policies.yml", "utf8");
assert.match(workflow, /cron:\s*"17 \* \* \* \*"/);
assert.match(workflow, /--manual-selection-only/);
assert.doesNotMatch(workflow, /--auto-select-analysis/);
assert.equal(HOURLY_POLICY_OPERATIONS_VERSION, "hourly-policy-operations-v1");

const sourceKeys = [
  "gov_zhengce_latest",
  "ndrc_policy_documents",
  "miit_policy_library",
  "nda_policy_release"
];
const candidates = [
  {
    title: "测试政策一",
    issuer: "测试部门",
    publishDate: "2026-07-12",
    dedupeKey: "policy-no:test:1",
    contentHash: "a".repeat(64)
  },
  {
    title: "测试政策二",
    issuer: "测试部门",
    publishDate: "2026-07-12",
    dedupeKey: "policy-no:test:2",
    contentHash: "b".repeat(64)
  }
];
const baseTime = Date.parse("2026-07-12T00:17:00.000Z");
const healthyRuns = Array.from({ length: 24 }, (_, index) => ({
  __artifactName: `hour-${String(index).padStart(2, "0")}.json`,
  crawledAt: new Date(baseTime + index * 60 * 60 * 1000).toISOString(),
  operatingMode: "hourly_collection_manual_analysis",
  automaticAnalysisSelection: false,
  runStatus: "ok",
  sourceKeys,
  sourceHealth: sourceKeys.map((sourceKey) => ({ sourceKey, status: "ok" })),
  counts: {
    candidates: candidates.length,
    withFullText: candidates.length,
    ingestSelected: candidates.length,
    manualEligible: 2,
    recommendedAnalysis: 2,
    analysisSelected: 0,
    queueOverflow: 0
  },
  candidates,
  analysisQueue: []
}));

const healthyAudit = auditHourlyCollectionRuns(healthyRuns, {
  expectedRuns: 24,
  requireClean: true
});
assert.equal(healthyAudit.valid, true);
assert.equal(healthyAudit.summary.runCount, 24);
assert.equal(healthyAudit.summary.automaticAnalysisSelections, 0);
assert.equal(healthyAudit.summary.distinctCandidatesObserved, 2);
assert.equal(healthyAudit.summary.newCandidateObservations, 2);
assert.equal(healthyAudit.summary.repeatedCandidateObservations, 46);
assert.equal(healthyAudit.summary.maxObservedGapMinutes, 60);
assert.equal(healthyAudit.hardErrors.length, 0);
assert.equal(healthyAudit.warnings.length, 0);
assert.ok(healthyAudit.sourceHealth.every((item) => item.okRuns === 24));

const autoSelectionRuns = structuredClone(healthyRuns);
autoSelectionRuns[5].automaticAnalysisSelection = true;
autoSelectionRuns[5].counts.analysisSelected = 1;
autoSelectionRuns[5].analysisQueue = [candidates[0]];
const autoSelectionAudit = auditHourlyCollectionRuns(autoSelectionRuns, {
  expectedRuns: 24,
  requireClean: true
});
assert.equal(autoSelectionAudit.valid, false);
assert.ok(autoSelectionAudit.hardErrors.some((item) => item.code === "automatic_analysis_selection_enabled"));
assert.ok(autoSelectionAudit.hardErrors.some((item) => item.code === "automatic_analysis_selection_detected"));

const starvedIngestRuns = structuredClone(healthyRuns);
starvedIngestRuns[3].counts.ingestSelected = 1;
const starvedIngestAudit = auditHourlyCollectionRuns(starvedIngestRuns, {
  expectedRuns: 24,
  requireClean: true
});
assert.equal(starvedIngestAudit.valid, false);
assert.ok(starvedIngestAudit.hardErrors.some((item) => item.code === "ingest_selection_starvation"));

const sourceFailureRuns = structuredClone(healthyRuns);
for (const index of [8, 9]) {
  sourceFailureRuns[index].runStatus = "degraded";
  sourceFailureRuns[index].sourceHealth = sourceFailureRuns[index].sourceHealth.map((item) =>
    item.sourceKey === "nda_policy_release" ? { ...item, status: "failed" } : item
  );
}
const sourceFailureAudit = auditHourlyCollectionRuns(sourceFailureRuns, {
  expectedRuns: 24,
  requireClean: true
});
assert.equal(sourceFailureAudit.valid, false);
assert.ok(sourceFailureAudit.warnings.some((item) => item.code === "source_consecutive_failures"));

const scheduleGapRuns = healthyRuns.filter((_, index) => index !== 12 && index !== 13);
const scheduleGapAudit = auditHourlyCollectionRuns(scheduleGapRuns, {
  expectedRuns: 24,
  requireClean: true
});
assert.equal(scheduleGapAudit.valid, false);
assert.ok(scheduleGapAudit.warnings.some((item) => item.code === "run_count_below_target"));
assert.ok(scheduleGapAudit.warnings.some((item) => item.code === "hourly_schedule_gap"));

assert.equal(candidateIdentity(candidates[0]), "policy-no:test:1");
assert.equal(candidateIdentity({ contentHash: "c".repeat(64) }), "c".repeat(64));
assert.equal(candidateIdentity({ sourceUrl: "https://example.com/a" }), "https://example.com/a");

console.log("[policy:hourly-operations-test] 24-run cadence, source health, deduplication, ingest coverage, and explicit-only analysis control passed");
