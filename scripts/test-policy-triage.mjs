#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildLimitedPolicyPlan,
  classifyPolicyCandidate
} from "./lib/policy-triage.mjs";

const interpretation = classifyPolicyCandidate({
  title: "关于某项政策的政策解读",
  fullText: "解读内容"
});
assert.equal(interpretation.analysisDepth, "L0");
assert.equal(interpretation.requiresManualAnalysis, false);

const subsidy = classifyPolicyCandidate({
  title: "关于设立专项资金支持技术改造的通知",
  policyNo: "工信函〔2026〕1号",
  fullText: "专项资金、财政补贴和项目申报安排。".repeat(40)
});
assert.equal(subsidy.analysisDepth, "L3");
assert.equal(subsidy.requiresManualAnalysis, true);

const directional = classifyPolicyCandidate({
  title: "关于推动产业数字化发展的指导意见",
  fullText: "支持企业数字化转型，完善基础设施和创新应用。".repeat(40)
});
assert.equal(directional.analysisDepth, "L2");

const candidates = [
  { title: "资金政策", publishDate: "2026-07-15", fullText: "专项资金、补贴、项目。".repeat(50) },
  { title: "指导意见", publishDate: "2026-07-14", fullText: "推动产业发展，完善基础设施。".repeat(50) },
  { title: "一般通知", publishDate: "2026-07-13", fullText: "一般性工作安排。".repeat(50) }
];
const manualPlan = buildLimitedPolicyPlan(candidates, {
  candidateLimit: 24,
  ingestLimit: 24,
  analysisPerRunLimit: 3,
  pendingQueueLimit: 8,
  automaticAnalysisSelection: false
});
assert.equal(manualPlan.analysisQueue.length, 0);
assert.equal(manualPlan.counts.analysisSelected, 0);
assert.ok(manualPlan.pendingQueue.length >= 1);

const explicitPlan = buildLimitedPolicyPlan(candidates, {
  automaticAnalysisSelection: true
});
assert.ok(explicitPlan.analysisQueue.length >= 1);

// Actual Actions run numbers advance only when a workflow starts. This
// provides progress across skipped wall-clock cron windows without changing
// the 24-item cap or the explicit manual-analysis gate.
const pool = Array.from({ length: 107 }, (_, i) => ({
  title: "关于实施政策编号" + String(i).padStart(3, "0") + "的通知",
  publishDate: "2026-10-01",
  sourceUrl: "https://example.gov.cn/policy/" + i,
  triage: {
    analysisDepth: "L3",
    reviewPriority: 100 - i,
    requiresManualAnalysis: true,
    excluded: false
  },
  fullText: "正式政策原文".repeat(80)
}));
const seen = new Set();
for (let sequence = 1; sequence <= 7; sequence += 1) {
  const result = buildLimitedPolicyPlan(pool, {
    candidateLimit: 24,
    ingestLimit: 24,
    selectionSequence: sequence,
    automaticAnalysisSelection: false
  });
  assert.equal(result.coverage.mode, "run_sequence_rotation");
  assert.equal(result.candidatePool.length, 24);
  assert.equal(result.counts.analysisSelected, 0);
  for (const item of pool.slice(0, 8)) {
    assert.ok(result.candidatePool.some(row => row.sourceUrl === item.sourceUrl));
  }
  result.candidatePool.forEach(row => seen.add(row.sourceUrl));
}
assert.equal(seen.size, 107, "all stable candidates reachable within seven successive executed runs");
const repeat = buildLimitedPolicyPlan(pool, { candidateLimit: 24, selectionSequence: 3 });
const repeated = buildLimitedPolicyPlan(pool, { candidateLimit: 24, selectionSequence: 3 });
assert.deepEqual(repeat.candidatePool.map(row => row.sourceUrl), repeated.candidatePool.map(row => row.sourceUrl));
const standalone = buildLimitedPolicyPlan(pool, { candidateLimit: 24 });
assert.equal(standalone.coverage.mode, "ranked");
assert.equal(standalone.candidatePool.length, 24);

console.log("[policy:triage-test] deterministic L0-L3 triage, 24-cap run-sequence coverage, and manual-selection gate passed");
