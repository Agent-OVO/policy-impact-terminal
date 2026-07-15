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

console.log("[policy:triage-test] deterministic L0-L3 triage and manual-selection gate passed");
