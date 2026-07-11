#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  RELATION_LEVELS,
  buildResearchIndexFromDisk,
  loadBuiltResearchIndex,
  queryResearchIndex,
  queryResearchTimeline,
  validateBuiltResearchIndex
} from "./lib/research-index.mjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const manualBefore = await hashJsonDirectory(path.resolve(root, "manual-reports"));
const first = await buildResearchIndexFromDisk(root);
const second = await buildResearchIndexFromDisk(root);
const built = await loadBuiltResearchIndex(root);

assert.deepEqual(first, second, "index construction must be deterministic");
assert.equal(first.sourceFingerprint, built.sourceFingerprint, "built projection must match current source fingerprint");
assert.deepEqual(first, built, "built projection must exactly match the current deterministic build");
assert.deepEqual(validateBuiltResearchIndex(first), { valid: true, errors: [] });

assert.equal(first.generatedFrom.candidateReportCount, 24);
assert.equal(first.generatedFrom.selectedReportCount, 24);
assert.equal(first.generatedFrom.manifestPolicyReferenceCount, 6);
assert.equal(first.generatedFrom.deduplication.length, 0);
assert.equal(first.summary.reportCount, 24);
assert.equal(first.policies.filter((item) => item.reportSource === "manual_report").length, 20);
assert.equal(first.policies.filter((item) => item.reportSource === "research_batch_candidate").length, 4);
assert.equal(new Set(first.policies.map((item) => item.policyId)).size, 24);
assert.ok(first.policies.every((item) => item.reportPath && item.reportVersion && item.reportContentHash));
assert.ok(first.policies.some((item) => item.stage9Metadata?.reportOrigin === "existing_validated"));

const wanhua = queryResearchIndex(first, "company", "万华化学");
assert.equal(wanhua.count, 1);
assert.ok(wanhua.results[0].policyCoverageCount >= 2);
assert.ok(wanhua.results[0].relationships.filter((item) => item.relationship === "policy_named").length >= 2);
assert.match(wanhua.disclaimer, /不等于订单数量/);
for (const relationship of first.companyRelations) {
  assert.ok(RELATION_LEVELS.includes(relationship.relationship));
  assert.ok(relationship.reportPath && relationship.reportVersion);
  assert.ok(Array.isArray(relationship.evidenceSources));
}

const ai = queryResearchIndex(first, "industry", "AI");
assert.ok(ai.count >= 1);
assert.ok(ai.results.some((item) => item.canonicalName === "人工智能"));
assert.ok(ai.normalizationHints.some((item) => item.includes("人工智能")));
const largeModel = queryResearchIndex(first, "industry", "大模型");
assert.ok(largeModel.results.some((item) => item.canonicalName === "人工智能"));
const priceTools = queryResearchIndex(first, "policy-tool", "价格");
assert.ok(priceTools.count >= 1);
assert.ok(priceTools.results.some((item) => item.policyCount >= 1));

const gridTimeline = queryResearchTimeline(first, "industry", "电网");
assert.ok(gridTimeline.count >= 1);
const timelineKeys = gridTimeline.results.map((item) => item.date ?? item.dateRange?.start ?? "9999-99-99");
assert.deepEqual(timelineKeys, [...timelineKeys].sort());
assert.ok(gridTimeline.results.some((item) => item.eventType === "price_execution"));
for (const event of first.events) {
  for (const field of [
    "eventId",
    "policyId",
    "eventType",
    "datePrecision",
    "source",
    "status",
    "description",
    "relatedIndustries",
    "relatedCompanies"
  ]) {
    assert.ok(Object.hasOwn(event, field), "event contract missing " + field);
  }
  assert.ok(event.date || event.dateRange || event.datePrecision === "unknown");
  if (!event.date && !event.dateRange) assert.ok(event.uncertainty, "undated event must expose uncertainty");
}

assert.equal(first.relationEvents.validation.valid, true);
assert.ok(first.relationEvents.events.some((item) =>
  item.changeType === "evidence_upgrade" &&
  item.fromLevel === "watch_only" &&
  item.toLevel === "policy_named" &&
  item.currentRelationship === "policy_named"
));
assert.ok(first.relationEvents.events.some((item) =>
  item.changeType === "evidence_downgrade" &&
  item.fromLevel === "direct_industry" &&
  item.toLevel === "watch_only" &&
  item.oppositeEvidence.length
));

assert.equal(first.watchlist.validation.valid, true);
assert.ok(first.watchlist.objects.length <= first.watchlist.capacity);
assert.deepEqual(first.watchlist.allowedStatuses, ["立即研究", "持续观察", "等待证据", "降级低频", "移出观察"]);
for (const item of first.watchlist.objects) {
  for (const field of [
    "objectType",
    "objectId",
    "displayName",
    "attentionLevel",
    "reasons",
    "evidenceState",
    "triggerRules",
    "invalidationRules",
    "nextReviewDate",
    "status"
  ]) {
    assert.ok(Object.hasOwn(item, field), "watchlist contract missing " + field);
  }
}

assert.equal(queryResearchIndex(first, "company", "阶段十不存在的公司名称").count, 0);
assert.equal(queryResearchIndex(first, "industry", "阶段十不存在的产业名称").count, 0);
const { stdout: emptyStdout } = await execFileAsync(process.execPath, [
  path.resolve(root, "scripts/query-research-index.mjs"),
  "company",
  "阶段十不存在的公司名称",
  "--json"
], { cwd: root, windowsHide: true });
const emptyCli = JSON.parse(emptyStdout);
assert.equal(emptyCli.count, 0);
assert.deepEqual(emptyCli.results, []);

const evidenceIds = new Set(first.evidence.map((item) => item.evidenceId));
for (const relation of first.companyRelations) {
  assert.ok(relation.evidenceIds.every((id) => evidenceIds.has(id)));
}
for (const item of first.evidence) {
  assert.ok(item.reportPath && item.policyId && item.reportVersion);
}

const migration = await fs.readFile(
  path.resolve(root, "supabase/migrations/20260711020000_stage10_cross_policy_observation_kernel.sql"),
  "utf8"
);
assert.doesNotMatch(migration, /create\s+table/i, "Stage 10 candidate must not duplicate local JSON state in tables");
assert.match(migration, /research_private\.current_company_relations/);
assert.match(migration, /current_published_revision_id/);
assert.match(migration, /public\.is_active_user\(\)/);
assert.match(migration, /public\.can_read_policy/);
assert.match(migration, /security definer/i);

const packageJson = JSON.parse(await fs.readFile(path.resolve(root, "package.json"), "utf8"));
for (const script of [
  "research:index",
  "research:query",
  "research:timeline",
  "research:watchlist",
  "stage10:kernel-test",
  "stage10:migration-test",
  "stage10:test"
]) {
  assert.ok(packageJson.scripts[script], "missing package script " + script);
}

const manualAfter = await hashJsonDirectory(path.resolve(root, "manual-reports"));
assert.deepEqual(manualAfter, manualBefore, "Stage 10 tests must not mutate manual reports");
console.log(
  "[stage10:kernel-test] deterministic index, deduplication, company/industry/tool queries, timeline, relation changes, watchlist, JSON contracts, empty results, and zero-table migration boundary passed " +
  JSON.stringify(first.summary)
);

async function hashJsonDirectory(directory) {
  const files = (await fs.readdir(directory)).filter((item) => item.endsWith(".json")).sort();
  const result = {};
  for (const file of files) {
    const content = await fs.readFile(path.join(directory, file));
    result[file] = crypto.createHash("sha256").update(content).digest("hex");
  }
  return result;
}
