const DEPTH_RANK = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3 });

const EXCLUSION_RULES = [
  { code: "interpretation", label: "政策解读、图解或答记者问", pattern: /政策解读|一图读懂|图解|专家解读|答记者问|新闻发布会|访谈实录|政策吹风会/ },
  { code: "personnel", label: "人事任免或人员信息", pattern: /人事任免|任免通知|任职通知|免职通知|关于.{0,20}同志任免|领导简历/ },
  { code: "meeting_news", label: "会议或一般工作动态", pattern: /召开.{0,18}会议|会议召开|工作动态|领导活动|调研活动|考察活动/ },
  { code: "commendation", label: "表彰、通报表扬或荣誉信息", pattern: /表彰|通报表扬|先进个人|先进集体|荣誉称号/ },
  { code: "opinion_feedback", label: "征求意见反馈或意见采纳说明", pattern: /征求意见.*反馈|意见采纳情况|意见征集结果|公开征求意见情况/ }
];

const STRONG_SIGNAL_RULES = [
  { code: "price_tax", label: "价格、税费或收费机制", weight: 5, pattern: /价格|水价|电价|气价|油价|关税|税率|减税|免税|退税|收费标准|收费管理/ },
  { code: "subsidy_fund", label: "补贴、补助或专项资金", weight: 5, pattern: /补贴|补助|奖励资金|专项资金|财政资金|贴息|政府投资基金|产业基金/ },
  { code: "procurement", label: "采购、招标或首批次应用", weight: 5, pattern: /政府采购|采购需求|招标|首台.?套|首批次|首版次|订购|采购目录/ },
  { code: "access_regulation", label: "准入、许可、强制监管或处罚", weight: 4, pattern: /市场准入|行业准入|准入条件|许可管理|行政许可|强制性|禁止|处罚|监管办法|安全审查|合规要求/ },
  { code: "standard_requirement", label: "标准、规范或技术要求", weight: 3, pattern: /国家标准|行业标准|强制性标准|技术标准|技术规范|技术要求|评价规范|认证规则/ },
  { code: "list_catalog", label: "目录、清单、名单或认定结果", weight: 3, pattern: /目录|清单|名单|认定|推荐目录|示范名单|试点名单/ },
  { code: "project_pilot", label: "项目、试点或示范任务", weight: 3, pattern: /重大项目|重点项目|项目清单|试点|示范工程|示范区|先行区|应用示范/ },
  { code: "implementation_deadline", label: "明确实施日期或完成时限", weight: 3, pattern: /自\d{4}年\d{1,2}月\d{1,2}日起施行|自发布之日起施行|截至\d{4}年|\d{4}年\d{1,2}月底前|\d{4}年底前|限期完成/ }
];

const RETROSPECTIVE_CASE_PATTERN = /公布.{0,24}典型(?:应用)?案例(?:名单)?|典型(?:应用)?案例名单|优秀案例名单/;
const FORWARD_COMPETITION_PATTERN = /揭榜挂帅|征集|申报|遴选|试点|示范任务|招标|采购|首批次|首台.?套/;
const STANDARD_PLAN_PATTERN = /标准制修订项目计划|标准项目计划/;
const BROAD_PLAN_PATTERN = /(?:“|《)?十五五(?:”|》)?规划|综合规划|发展规划|建设规划/;
const DIRECT_SUBJECT_PATTERN = /牵头单位|主要起草单位|入围.{0,12}单位|中标单位|供应商名单|申报单位|推荐单位/;

const DIRECTION_RULES = [
  { code: "plan_measure", label: "规划、行动计划或实施措施", weight: 3, pattern: /规划|行动计划|实施方案|实施意见|指导意见|若干措施|工作要点|专项行动|发展纲要/ },
  { code: "industrial_action", label: "存在产业或市场行动要求", weight: 2, pattern: /产业|企业|市场|投资|基础设施|供应链|产业链|数字化|智能化|绿色化|技术改造|创新应用|扩大内需|消费|制造业|能源|数据要素|人工智能/ },
  { code: "action_verb", label: "包含支持、推动或建设等政策动作", weight: 2, pattern: /支持|推动|加快|促进|建设|发展|完善|提升|改造|培育|鼓励|扩大|优化|实施/ },
  { code: "formal_document", label: "正式政策文件", weight: 1, pattern: /通知|意见|办法|规定|决定|公告|方案|细则|指南|指引|条例|规划/ }
];

export function classifyPolicyCandidate(candidate) {
  const title = normalizeText(candidate?.title);
  const policyNo = normalizeText(candidate?.policyNo);
  const fullText = normalizeText(candidate?.fullText).slice(0, 12000);
  const rawText = normalizeText(flatten(candidate?.raw)).slice(0, 4000);
  const corpus = `${title}\n${policyNo}\n${rawText}\n${fullText}`;

  const exclusion = EXCLUSION_RULES.find((rule) => rule.pattern.test(`${title}\n${rawText}`));
  if (exclusion) {
    return {
      analysisDepth: "L0",
      reviewPriority: 0,
      requiresManualAnalysis: false,
      excluded: true,
      reasons: [exclusion.label],
      signals: [exclusion.code]
    };
  }

  const strongMatches = matchRules(corpus, STRONG_SIGNAL_RULES);
  const titleStrongMatches = matchRules(`${title}\n${policyNo}`, STRONG_SIGNAL_RULES);
  const directionMatches = matchRules(corpus, DIRECTION_RULES);
  const strongScore = strongMatches.reduce((sum, item) => sum + item.weight, 0);
  const titleStrongScore = titleStrongMatches.reduce((sum, item) => sum + item.weight, 0);
  const directionScore = directionMatches.reduce((sum, item) => sum + item.weight, 0);
  const hasPolicyNumber = Boolean(policyNo);
  const hasSubstantiveText = fullText.length >= 280;
  const isRetrospectiveCase = RETROSPECTIVE_CASE_PATTERN.test(`${title}\n${rawText}`);
  const isForwardCompetitionTitle = FORWARD_COMPETITION_PATTERN.test(title);
  const isForwardCompetition = FORWARD_COMPETITION_PATTERN.test(`${title}\n${rawText}\n${fullText.slice(0, 3000)}`);
  const isRetrospectiveOnly = isRetrospectiveCase && !isForwardCompetitionTitle;
  const isStandardPlan = STANDARD_PLAN_PATTERN.test(title);
  const isBroadPlan = BROAD_PLAN_PATTERN.test(title) && titleStrongMatches.length === 0;
  const hasDirectSubjects = DIRECT_SUBJECT_PATTERN.test(`${rawText}\n${fullText}`);

  let analysisDepth;
  const directionCodes = new Set(directionMatches.map((item) => item.code));
  const hasDirectionalPolicyAction =
    directionCodes.has("plan_measure") ||
    (directionCodes.has("industrial_action") &&
      (directionCodes.has("action_verb") || directionCodes.has("formal_document")));

  if (isRetrospectiveOnly) {
    analysisDepth = "L2";
  } else if (titleStrongMatches.length > 0 || strongScore >= 5 || strongMatches.some((item) => item.weight >= 5)) {
    analysisDepth = "L3";
  } else if (hasDirectionalPolicyAction) {
    analysisDepth = "L2";
  } else {
    analysisDepth = "L1";
  }

  const policyToolStrength = scorePolicyToolStrength({
    analysisDepth,
    strongMatches,
    titleStrongMatches,
    isForwardCompetition,
    isStandardPlan,
    isBroadPlan
  });
  const incrementalIndustryImpact = scoreIncrementalIndustryImpact({
    analysisDepth,
    strongMatches,
    directionMatches,
    isRetrospectiveCase,
    isForwardCompetition,
    isStandardPlan,
    isBroadPlan
  });
  const companyVerifiability = scoreCompanyVerifiability({
    title,
    fullText,
    rawText,
    isRetrospectiveCase,
    isForwardCompetition,
    isStandardPlan,
    hasDirectSubjects
  });
  const contextAdjustment =
    (hasPolicyNumber ? 2 : 0) +
    (hasSubstantiveText ? 2 : 0) -
    (isRetrospectiveOnly ? 8 : 0);
  const reviewPriority = clamp(
    Math.round(
      policyToolStrength * 0.45 +
      incrementalIndustryImpact * 0.35 +
      companyVerifiability * 0.2 +
      contextAdjustment
    ),
    0,
    100
  );

  const matched = [...strongMatches, ...directionMatches];
  const reasons = unique(matched.map((item) => item.label));
  if (reasons.length === 0) reasons.push("正式政策，但暂未识别出需要优先深度分析的强动作");

  return {
    analysisDepth,
    reviewPriority,
    policyToolStrength,
    incrementalIndustryImpact,
    companyVerifiability,
    requiresManualAnalysis: analysisDepth === "L2" || analysisDepth === "L3",
    excluded: false,
    reasons: reasons.slice(0, 6),
    signals: unique(matched.map((item) => item.code)).slice(0, 10)
  };
}

export function attachPolicyTriage(candidate) {
  return {
    ...candidate,
    triage: classifyPolicyCandidate(candidate)
  };
}

export function rankTriagedCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    const depthOrder = DEPTH_RANK[b?.triage?.analysisDepth] - DEPTH_RANK[a?.triage?.analysisDepth];
    if (depthOrder) return depthOrder;
    const priorityOrder = Number(b?.triage?.reviewPriority ?? 0) - Number(a?.triage?.reviewPriority ?? 0);
    if (priorityOrder) return priorityOrder;
    const dateOrder = normalizeText(b?.publishDateTime ?? b?.publishDate).localeCompare(
      normalizeText(a?.publishDateTime ?? a?.publishDate)
    );
    if (dateOrder) return dateOrder;
    const sourceOrder = Number(b?.sourcePriority ?? 0) - Number(a?.sourcePriority ?? 0);
    if (sourceOrder) return sourceOrder;
    return normalizeText(a?.title).localeCompare(normalizeText(b?.title), "zh-CN");
  });
}

export function buildLimitedPolicyPlan(candidates, options = {}) {
  const candidateLimit = toPositiveInteger(options.candidateLimit, 24);
  const ingestLimit = toPositiveInteger(options.ingestLimit, 12);
  const analysisPerRunLimit = toPositiveInteger(options.analysisPerRunLimit, 3);
  const pendingQueueLimit = toPositiveInteger(options.pendingQueueLimit, 8);
  const hasUsableFullText = options.hasUsableFullText ?? ((item) => normalizeText(item?.fullText).length >= 280);

  const triaged = rankTriagedCandidates(candidates.map((item) => item?.triage ? item : attachPolicyTriage(item)));
  const excluded = triaged.filter((item) => item.triage.excluded);
  const candidatePool = triaged.filter((item) => !item.triage.excluded).slice(0, candidateLimit);
  const eligibleForIngest = candidatePool.filter((item) => hasUsableFullText(item));
  const ingestCandidates = eligibleForIngest.slice(0, ingestLimit);
  const manualEligible = eligibleForIngest.filter((item) => item.triage.requiresManualAnalysis);
  const pendingQueue = manualEligible.slice(0, pendingQueueLimit);
  const analysisQueue = pendingQueue.slice(0, analysisPerRunLimit);

  return {
    triaged,
    candidatePool,
    excluded,
    ingestCandidates,
    pendingQueue,
    analysisQueue,
    deferredManualCandidates: manualEligible.slice(analysisPerRunLimit),
    queueOverflow: Math.max(0, manualEligible.length - pendingQueueLimit),
    counts: {
      triagedTotal: triaged.length,
      candidates: candidatePool.length,
      L0: triaged.filter((item) => item.triage.analysisDepth === "L0").length,
      L1: triaged.filter((item) => item.triage.analysisDepth === "L1").length,
      L2: triaged.filter((item) => item.triage.analysisDepth === "L2").length,
      L3: triaged.filter((item) => item.triage.analysisDepth === "L3").length,
      excluded: excluded.length,
      ingestSelected: ingestCandidates.length,
      manualEligible: manualEligible.length,
      analysisSelected: analysisQueue.length,
      queueOverflow: Math.max(0, manualEligible.length - pendingQueueLimit)
    },
    limits: {
      candidateLimit,
      ingestLimit,
      analysisPerRunLimit,
      pendingQueueLimit
    }
  };
}

function scorePolicyToolStrength({ analysisDepth, strongMatches, titleStrongMatches, isForwardCompetition, isStandardPlan, isBroadPlan }) {
  const strongScore = strongMatches.reduce((sum, item) => sum + item.weight, 0);
  const titleScore = titleStrongMatches.reduce((sum, item) => sum + item.weight, 0);
  return clamp(
    (analysisDepth === "L3" ? 48 : analysisDepth === "L2" ? 32 : 14) +
      Math.min(strongScore * 3, 24) +
      Math.min(titleScore * 5, 25) +
      (isForwardCompetition ? 8 : 0) +
      (isStandardPlan ? 4 : 0) -
      (isBroadPlan ? 8 : 0),
    0,
    100
  );
}

function scoreIncrementalIndustryImpact({ analysisDepth, strongMatches, directionMatches, isRetrospectiveCase, isForwardCompetition, isStandardPlan, isBroadPlan }) {
  if (isRetrospectiveCase) return 24;
  if (isBroadPlan) return 58;
  const strongCodes = new Set(strongMatches.map((item) => item.code));
  const directMarketChange = ["price_tax", "subsidy_fund", "procurement", "access_regulation"].some((code) => strongCodes.has(code));
  const base = directMarketChange ? 78 : isForwardCompetition ? 72 : isStandardPlan ? 52 : analysisDepth === "L3" ? 62 : analysisDepth === "L2" ? 54 : 25;
  return clamp(base + Math.min(directionMatches.length * 3, 12), 0, 100);
}

function scoreCompanyVerifiability({ title, fullText, rawText, isRetrospectiveCase, isForwardCompetition, isStandardPlan, hasDirectSubjects }) {
  const text = `${title}\n${rawText}\n${fullText}`;
  if (hasDirectSubjects) return isRetrospectiveCase ? 92 : 94;
  if (/名单|目录|认定结果/.test(title) && /单位|企业|机构/.test(text)) return 82;
  if (isStandardPlan && /主要起草单位/.test(text)) return 88;
  if (isForwardCompetition) return 58;
  if (/价格|税率|收费标准/.test(title)) return 55;
  return 38;
}

function matchRules(text, rules) {
  return rules.filter((rule) => rule.pattern.test(text));
}

function flatten(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flatten).join(" ");
  if (typeof value === "object") return Object.values(value).map(flatten).join(" ");
  return "";
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
