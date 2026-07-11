#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { loadFirstSixBatch, buildFirstSixResearchIndex } from "./query-stage9-first-six.mjs";
import { loadQueueDisposition, validateQueueDisposition } from "./manage-stage9-first-six-queue.mjs";

const root = process.cwd();
const batch = await loadFirstSixBatch(root);
const manifest = batch.manifest;
assert.equal(manifest.batchId, "stage9-first-six");
assert.equal(manifest.policies.length, 6);
assert.equal(new Set(manifest.policies.map((item) => item.title)).size, 6);
assert.equal(manifest.policies.filter((item) => item.reportDepth === "deep").length, 3);
assert.equal(manifest.policies.filter((item) => item.reportDepth === "standard").length, 3);
assert.equal(manifest.scope.productionWrite, false);
assert.equal(manifest.scope.modelCalls, 0);
assert.ok(manifest.policies.every((item) => item.validationStatus === "strict_pass"));

for (const entry of batch.policies) {
  assert.equal(entry.report.policy?.title ?? entry.report.summary?.title, entry.manifest.title);
  assert.ok(Array.isArray(entry.report.actions) && entry.report.actions.length >= 2);
  assert.ok(Array.isArray(entry.report.evidence) && entry.report.evidence.length >= 2);
}

const sourceAudit = JSON.parse(await fs.readFile(path.join(root, "research-batches/stage9-first-six/source-audit.json"), "utf8"));
assert.equal(sourceAudit.auditStatus, "passed");
assert.equal(sourceAudit.items.length, 6);
assert.ok(sourceAudit.items.every((item) => item.officialPage && item.sourceConclusion));
assert.ok(sourceAudit.items.flatMap((item) => item.attachments ?? []).every((item) => item.readStatus === "verified"));

const matrix = JSON.parse(await fs.readFile(path.join(root, "research-batches/stage9-first-six/cross-policy-matrix.json"), "utf8"));
assert.equal(matrix.rows.length, 6);
assert.deepEqual(
  new Set(matrix.rows.map((item) => item.policyKey)),
  new Set(manifest.policies.map((item) => item.policyKey))
);
assert.ok(matrix.rows.every((item) => item.automatedTriage && item.mainCounterEvidence && item.researchDisposition));

const calibration = JSON.parse(await fs.readFile(path.join(root, "research-batches/stage9-first-six/triage-calibration.json"), "utf8"));
assert.equal(calibration.status, "implemented_and_tested");
assert.equal(calibration.dimensions.length, 3);
assert.ok(calibration.misjudgementsFound.length >= 4);

const queue = await loadQueueDisposition(undefined, root);
const queueResult = validateQueueDisposition(queue);
assert.equal(queueResult.itemCount, 8);
assert.equal(queueResult.counts.immediate_analysis, 3);
assert.equal(queueResult.counts.retain_observation, 3);
assert.equal(queueResult.counts.downgrade_archive, 1);
assert.equal(queueResult.counts.defer_pending_evidence, 1);

const index = buildFirstSixResearchIndex(batch);
assert.equal(index.policyIndex.length, 6);
assert.ok(index.industryIndex.length >= 20);
assert.ok(index.companyIndex.length >= 15);
assert.equal(index.companyIndex.filter((item) => item.policyTitle.includes("农业领域机器人")).length, 0);

console.log(`[stage9:first-six-batch-test] policies=6 sources=6 industries=${index.industryIndex.length} companies=${index.companyIndex.length} queue=${queueResult.itemCount}`);
