#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  attachPolicyTriage,
  buildLimitedPolicyPlan,
  classifyPolicyCandidate,
  rankTriagedCandidates
} from "./lib/policy-triage.mjs";

const filler = "本文件用于说明政策执行范围、责任主体、实施程序和监督要求。".repeat(12);

const interpretation = classifyPolicyCandidate({
  title: "一图读懂《制造业数字化转型行动计划》",
  fullText: filler
});
assert.equal(interpretation.analysisDepth, "L0");
assert.equal(interpretation.excluded, true);
assert.equal(interpretation.requiresManualAnalysis, false);

const weakFormal = classifyPolicyCandidate({
  title: "关于公布2026年度部门预算的通知",
  policyNo: "财预〔2026〕1号",
  fullText: filler
});
assert.equal(weakFormal.analysisDepth, "L1");
assert.equal(weakFormal.requiresManualAnalysis, false);

const directional = classifyPolicyCandidate({
  title: "关于印发推动制造业数字化转型行动计划的通知",
  policyNo: "工信部规〔2026〕12号",
  fullText: `${filler} 支持制造业企业推进数字化改造，建设行业平台，促进产业链协同发展。`
});
assert.equal(directional.analysisDepth, "L2");
assert.equal(directional.requiresManualAnalysis, true);

const subsidy = classifyPolicyCandidate({
  title: "关于开展2026年新能源汽车购置补贴申报工作的通知",
  policyNo: "财建〔2026〕8号",
  fullText: `${filler} 对符合条件的项目给予财政补贴，申报截至2026年9月底前。`
});
assert.equal(subsidy.analysisDepth, "L3");
assert.equal(subsidy.requiresManualAnalysis, true);
assert.ok(subsidy.reviewPriority > directional.reviewPriority);
assert.ok(subsidy.policyToolStrength > 0);
assert.ok(subsidy.incrementalIndustryImpact > 0);
assert.ok(subsidy.companyVerifiability > 0);

const retrospectiveCase = classifyPolicyCandidate({
  title: "关于公布2025年物联网赋能行业发展典型案例名单的通知",
  fullText: `${filler} 经推荐、评审和公示，现公布典型案例名单，推动优秀成果推广应用。`
});
const revealCompetition = classifyPolicyCandidate({
  title: "关于公布精细化工关键产品创新任务揭榜挂帅入围揭榜单位名单的通知",
  fullText: `${filler} 入围单位三年内完成攻关，开展中试、测评和首批次应用推广，牵头单位名单如下。`
});
assert.equal(retrospectiveCase.analysisDepth, "L2");
assert.ok(retrospectiveCase.incrementalIndustryImpact < revealCompetition.incrementalIndustryImpact);
assert.ok(retrospectiveCase.reviewPriority < revealCompetition.reviewPriority);
assert.ok(retrospectiveCase.companyVerifiability < revealCompetition.companyVerifiability);

const standardPlan = classifyPolicyCandidate({
  title: "工业和信息化部办公厅关于印发2026年第四批行业标准制修订项目计划的通知",
  fullText: `${filler} 共安排行业标准项目805项，主要起草单位、项目周期和技术归口单位详见附件。`
});
assert.equal(standardPlan.analysisDepth, "L3");
assert.ok(standardPlan.policyToolStrength >= 50);
assert.ok(standardPlan.incrementalIndustryImpact < subsidy.incrementalIndustryImpact);

const broadPlan = classifyPolicyCandidate({
  title: "国务院关于印发《美丽中国建设“十五五”规划》的通知",
  fullText: `${filler} 完善价格、采购、准入、标准、目录和试点等政策工具，系统推进生态环境治理。`
});
assert.equal(broadPlan.analysisDepth, "L3");
assert.ok(broadPlan.incrementalIndustryImpact < subsidy.incrementalIndustryImpact);
assert.ok(broadPlan.reviewPriority < subsidy.reviewPriority);

const mandatoryStandard = classifyPolicyCandidate({
  title: "关于发布数据中心能效强制性国家标准的公告",
  fullText: `${filler} 本标准为强制性国家标准，自2027年1月1日起施行。`
});
assert.equal(mandatoryStandard.analysisDepth, "L3");
assert.ok(mandatoryStandard.signals.includes("standard_requirement"));
assert.ok(mandatoryStandard.signals.includes("access_regulation"));

const ranked = rankTriagedCandidates([
  attachPolicyTriage({ title: "一般预算通知", publishDate: "2026-07-11", fullText: filler }),
  attachPolicyTriage({ title: "制造业数字化转型行动计划", publishDate: "2026-07-10", fullText: filler }),
  attachPolicyTriage({ title: "新能源汽车补贴申报通知", publishDate: "2026-07-09", fullText: `${filler} 财政补贴` })
]);
assert.equal(ranked[0].triage.analysisDepth, "L3");

const candidates = [
  { title: "新能源汽车补贴申报通知", fullText: `${filler} 财政补贴`, publishDate: "2026-07-11" },
  { title: "数据中心强制性标准公告", fullText: `${filler} 强制性国家标准`, publishDate: "2026-07-10" },
  { title: "制造业数字化转型行动计划", fullText: `${filler} 推动制造业数字化改造`, publishDate: "2026-07-09" },
  { title: "人工智能产业发展实施方案", fullText: `${filler} 支持人工智能产业发展`, publishDate: "2026-07-08" },
  { title: "关于公布部门预算的通知", fullText: filler, publishDate: "2026-07-07" },
  { title: "政策解读：制造业行动计划", fullText: filler, publishDate: "2026-07-06" },
  { title: "无正文的产业规划", fullText: "太短", publishDate: "2026-07-05" }
];

const plan = buildLimitedPolicyPlan(candidates, {
  candidateLimit: 6,
  ingestLimit: 4,
  analysisPerRunLimit: 2,
  pendingQueueLimit: 3
});
assert.equal(plan.triaged.length, 7);
assert.equal(plan.candidatePool.length, 6);
assert.equal(plan.ingestCandidates.length, 4);
assert.equal(plan.analysisQueue.length, 2);
assert.equal(plan.pendingQueue.length, 3);
assert.ok(plan.excluded.some((item) => item.triage.analysisDepth === "L0"));
assert.ok(plan.ingestCandidates.every((item) => item.fullText.length >= 280));
assert.ok(plan.analysisQueue.every((item) => item.triage.requiresManualAnalysis));
assert.equal(plan.limits.analysisPerRunLimit, 2);

const defaultBoundedPlan = buildLimitedPolicyPlan(
  Array.from({ length: 10 }, (_, index) => ({
    title: `第${index + 1}项产业补贴实施通知`,
    fullText: `${filler} 对符合条件的产业项目给予财政补贴。`,
    publishDate: `2026-07-${String(11 - index).padStart(2, "0")}`
  }))
);
assert.equal(defaultBoundedPlan.pendingQueue.length, 8);
assert.equal(defaultBoundedPlan.analysisQueue.length, 3);
assert.equal(defaultBoundedPlan.queueOverflow, 2);
assert.equal(defaultBoundedPlan.deferredManualCandidates.length, 7);
assert.deepEqual(
  defaultBoundedPlan.analysisQueue.map((item) => item.title),
  defaultBoundedPlan.pendingQueue.slice(0, 3).map((item) => item.title)
);

console.log("[policy:triage-test] deterministic L0-L3 classification, ranking, and queue limits passed");
