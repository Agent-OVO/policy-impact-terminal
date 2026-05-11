import {
  errorResponse,
  handleOptions,
  HttpError,
  isRecord,
  jsonResponse,
  readJsonObject,
  requirePost,
  requireString
} from "../_shared/http.ts";
import {
  createSupabaseAdminClient,
  requireAnalysisJobRecord,
  requireCrawlerOrAdminUser
} from "../_shared/supabaseAdmin.ts";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type PolicyRecord = {
  id: string;
  external_id: string | null;
  title: string;
  issuer: string | null;
  publish_date: string | null;
  effective_date: string | null;
  source_name: string | null;
  source_url: string | null;
  category: string | null;
  policy_level: string | null;
  confidence: number | null;
  summary: string | null;
  full_text: string | null;
  metadata: Record<string, unknown>;
};

const MIN_POLICY_FULL_TEXT_LENGTH = 280;

type IndustryRule = {
  id: string;
  title: string;
  subtitle: string;
  section: "upstream" | "midstream" | "downstream" | "support";
  keywords: string[];
  relation: string;
  evidenceLevel: string;
  description: string;
};

const INDUSTRY_RULES: IndustryRule[] = [
  {
    id: "ai",
    title: "人工智能应用",
    subtitle: "模型、算法、智能化场景",
    section: "downstream",
    keywords: ["人工智能", "AI", "智能", "大模型", "算法", "算力"],
    relation: "直接相关",
    evidenceLevel: "强证据",
    description: "政策文本直接涉及人工智能、模型或算力相关部署，相关场景具备明确政策触发信号。"
  },
  {
    id: "data",
    title: "数据要素与数据服务",
    subtitle: "数据资源、流通、开发利用",
    section: "midstream",
    keywords: ["数据", "数据要素", "公共数据", "数据资源", "数据产品", "数据流通"],
    relation: "直接相关",
    evidenceLevel: "强证据",
    description: "政策文本涉及数据资源供给、开发利用或数据流通，数据服务环节需要重点跟踪。"
  },
  {
    id: "energy",
    title: "能源与绿色低碳",
    subtitle: "电力、能源、安全供给",
    section: "support",
    keywords: ["能源", "电力", "绿色", "低碳", "碳", "能效", "清洁能源"],
    relation: "直接相关",
    evidenceLevel: "强证据",
    description: "政策文本涉及能源供给、能效或绿色低碳要求，相关基础保障环节具备政策约束和机会。"
  },
  {
    id: "manufacturing",
    title: "工业制造与装备",
    subtitle: "制造业、装备、工业场景",
    section: "downstream",
    keywords: ["工业", "制造", "装备", "工厂", "中小企业", "产业链"],
    relation: "间接相关",
    evidenceLevel: "间接证据",
    description: "政策文本涉及工业制造或产业链协同，可能影响制造业数字化和装备服务需求。"
  },
  {
    id: "infrastructure",
    title: "数字基础设施",
    subtitle: "平台、网络、系统、算力设施",
    section: "upstream",
    keywords: ["基础设施", "平台", "网络", "系统", "算力设施", "服务平台"],
    relation: "潜在受益",
    evidenceLevel: "间接证据",
    description: "政策文本涉及平台或基础设施建设，相关基础服务可能获得新增需求。"
  },
  {
    id: "security",
    title: "安全合规与治理",
    subtitle: "监管、安全、标准、合规",
    section: "support",
    keywords: ["安全", "监管", "合规", "标准", "风险", "审查", "治理"],
    relation: "约束风险",
    evidenceLevel: "强证据",
    description: "政策文本涉及安全、监管、标准或合规要求，相关主体需要评估约束和合规成本。"
  }
];

const CANDIDATE_MAPPING_NOTE = "基于政策文本关键词与公开业务标签的候选映射，不构成公司持续跟踪或投资结论。";

type CompanyCandidateTemplate = {
  id: string;
  name: string;
  ticker: string;
  platform: string;
  status: string;
  products: string[];
};

type CompanyCandidate = {
  id: string;
  name: string;
  ticker: string;
  platform: string;
  status: string;
  section: IndustryRule["section"];
  relation: string;
  evidence: string;
  evidenceLevel: string;
  confidence: number;
  policyRelevance: number;
  evidenceCertainty: number;
  evidenceCount: number;
  products: string[];
  nodeIds: string[];
  clauseIds: string[];
  evidenceIds: string[];
  reason: string;
  uncertainty: string;
};

type ExtractedPolicyClause = ReturnType<typeof extractPolicyClauses>[number];
type ReportEvidenceItem = {
  id: string;
  clauseIds: string[];
  confidence: number;
};

const COMPANY_CANDIDATE_TEMPLATES: Record<string, CompanyCandidateTemplate[]> = {
  ai: [
    {
      id: "candidate-iflytek",
      name: "科大讯飞",
      ticker: "002230.SZ",
      platform: "智能语音、认知大模型与行业 AI 应用",
      status: "代表性上市公司候选",
      products: ["讯飞星火", "智能语音", "行业 AI 应用"]
    },
    {
      id: "candidate-baidu-ai",
      name: "百度智能云",
      ticker: "BIDU / 9888.HK",
      platform: "大模型、AI 云与智能应用开发平台",
      status: "代表性平台型机构候选",
      products: ["文心大模型", "AI 云服务", "智能应用平台"]
    }
  ],
  data: [
    {
      id: "candidate-sh-data-exchange",
      name: "上海数据交易所",
      ticker: "未上市机构",
      platform: "数据交易、数据产品登记与流通服务",
      status: "代表性市场基础设施候选",
      products: ["数据交易", "数据产品登记", "合规流通服务"]
    },
    {
      id: "candidate-e-hualu",
      name: "易华录",
      ticker: "300212.SZ",
      platform: "数据湖、公共数据开发利用与数字城市服务",
      status: "代表性上市公司候选",
      products: ["数据湖", "公共数据运营", "数字城市"]
    }
  ],
  energy: [
    {
      id: "candidate-sgcc-ict",
      name: "国网信通",
      ticker: "600131.SH",
      platform: "电力数字化、能源互联网与企业信息化",
      status: "代表性上市公司候选",
      products: ["电力数字化", "能源互联网", "企业信息化"]
    },
    {
      id: "candidate-csg-technology",
      name: "南网科技",
      ticker: "688248.SH",
      platform: "电力技术服务、储能与节能低碳服务",
      status: "代表性上市公司候选",
      products: ["储能服务", "节能低碳", "电力技术服务"]
    }
  ],
  manufacturing: [
    {
      id: "candidate-supcon",
      name: "中控技术",
      ticker: "688777.SH",
      platform: "工业自动化、工业软件与智能制造解决方案",
      status: "代表性上市公司候选",
      products: ["工业控制", "工业软件", "智能制造"]
    },
    {
      id: "candidate-digiwin",
      name: "鼎捷数智",
      ticker: "300378.SZ",
      platform: "制造业数字化、ERP 与工业互联网应用",
      status: "代表性上市公司候选",
      products: ["ERP", "制造业数字化", "工业互联网应用"]
    }
  ],
  infrastructure: [
    {
      id: "candidate-aliyun",
      name: "阿里云",
      ticker: "BABA / 9988.HK",
      platform: "云计算、数据基础设施与算力服务",
      status: "代表性平台型机构候选",
      products: ["云计算", "数据基础设施", "算力服务"]
    },
    {
      id: "candidate-china-mobile",
      name: "中国移动",
      ticker: "600941.SH / 0941.HK",
      platform: "通信网络、算力网络与云网融合服务",
      status: "代表性上市公司候选",
      products: ["5G 网络", "算力网络", "移动云"]
    }
  ],
  security: [
    {
      id: "candidate-qianxin",
      name: "奇安信",
      ticker: "688561.SH",
      platform: "网络安全、数据安全与合规治理服务",
      status: "代表性上市公司候选",
      products: ["数据安全", "网络安全", "合规治理"]
    },
    {
      id: "candidate-sangfor",
      name: "深信服",
      ticker: "300454.SZ",
      platform: "网络安全、云安全与企业级安全服务",
      status: "代表性上市公司候选",
      products: ["云安全", "网络安全", "零信任"]
    }
  ]
};

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    requirePost(req);

    const supabase = createSupabaseAdminClient();
    await requireCrawlerOrAdminUser(req, supabase);
    const body = await readJsonObject(req);
    const jobId = requireString(body, "jobId");
    const job = await requireAnalysisJobRecord(supabase, jobId);
    const now = new Date().toISOString();
    const existingOutput = isRecord(job.output_payload) ? job.output_payload : {};

    if (!job.policy_id) {
      throw new HttpError(409, "Analysis job has no policy_id. Create jobs through ingest before analyzing.");
    }

    if (job.status === "published") {
      return jsonResponse({ error: "Analysis job is already published." }, 409);
    }

    if (job.status === "failed") {
      return jsonResponse({ error: "Analysis job is failed and cannot be analyzed." }, 409);
    }

    const policy = await fetchPolicy(supabase, job.policy_id);
    if (!hasUsablePolicyText(policy.full_text)) {
      throw new HttpError(
        409,
        "Policy full_text is missing or too short. Scheduled analysis requires the original policy text, not only title or summary metadata."
      );
    }

    const reportPayload = buildReportPayload(policy, now);
    const analysisOutput = {
      analyzerVersion: "rules-v0.1",
      analyzedAt: now,
      status: "analysis_complete",
      reportPayload,
      fullTextLength: policy.full_text?.length ?? 0
    };

    const { data: updatedJob, error: jobError } = await supabase
      .from("analysis_jobs")
      .update({
        status: "analyzing",
        progress: 85,
        current_step: "已生成基础政策产业影响分析，等待发布",
        started_at: now,
        output_payload: {
          ...existingOutput,
          analysisStub: analysisOutput,
          analysis: analysisOutput,
          reportPayload
        },
        error_message: null
      })
      .eq("id", job.id)
      .select("id,policy_id,title,source_url,source_name,status,progress,created_at,current_step")
      .single();

    if (jobError || !updatedJob) {
      throw jobError ?? new Error("Analysis job update returned no row.");
    }

    const existingPolicyMetadata = isRecord(policy.metadata) ? policy.metadata : {};
    const { error: policyError } = await supabase
      .from("policies")
      .update({
        status: "reviewing",
        analysis_version: "rules-v0.1",
        confidence: reportPayload.policy.confidence,
        category: reportPayload.policy.category,
        summary: reportPayload.actions[0]?.body ?? policy.summary,
        metadata: {
          ...existingPolicyMetadata,
          analysis: analysisOutput,
          analysisStub: analysisOutput,
          reportPayload,
          policyReport: reportPayload,
          counts: {
            industryCount: reportPayload.chainNodes.length,
            companyCount: reportPayload.companies.length,
            evidenceCount: reportPayload.evidence.length,
            primarySignal: reportPayload.chainNodes[0]?.title ?? "待分析"
          }
        }
      })
      .eq("id", job.policy_id);

    if (policyError) {
      throw policyError;
    }

    return jsonResponse({
      job: updatedJob,
      analysis: analysisOutput,
      next: ["publish"]
    });
  } catch (error) {
    return errorResponse(error);
  }
});

async function fetchPolicy(
  supabase: SupabaseAdminClient,
  policyId: string
): Promise<PolicyRecord> {
  const { data, error } = await supabase
    .from("policies")
    .select("id,external_id,title,issuer,publish_date,effective_date,source_name,source_url,category,policy_level,confidence,summary,full_text,metadata")
    .eq("id", policyId)
    .single();

  if (error || !data) {
    throw new HttpError(404, "Linked policy not found.", error);
  }

  return {
    ...(data as PolicyRecord),
    metadata: isRecord((data as PolicyRecord).metadata) ? (data as PolicyRecord).metadata : {}
  };
}

function buildReportPayload(policy: PolicyRecord, generatedAt: string) {
  const fullText = normalizeText(policy.full_text ?? "");
  const text = normalizeText(`${policy.title}\n${policy.summary ?? ""}\n${fullText}`);
  const matchedRules = matchIndustryRules(text);
  const clauses = extractPolicyClauses(fullText);
  const evidenceBase = clauses.map((clause, index) => ({
    id: `evidence-${index + 1}`,
    title: `${clause.no} 原文证据`,
    source: policy.source_name ?? "政策原文",
    type: "政策原文",
    date: policy.publish_date ?? "",
    excerpt: clause.excerpt,
    confidence: clause.confidence,
    url: policy.source_url ?? undefined,
    clauseIds: [clause.id],
    nodeIds: matchedRules.slice(0, 3).map((rule) => rule.id),
    companyIds: [] as string[]
  }));
  const companies = buildCompanyCandidates(matchedRules, clauses, evidenceBase);
  const evidence = evidenceBase.map((item) => ({
    ...item,
    companyIds: companies
      .filter((company) => company.evidenceIds.includes(item.id))
      .map((company) => company.id)
  }));
  const companyIdsByNodeId = buildCompanyIdsByNodeId(companies);
  const actions = buildActions(matchedRules, clauses);
  const impactScope = inferImpactScope(policy);
  const chainNodes = matchedRules.map((rule, index) => ({
    id: rule.id,
    title: rule.title,
    subtitle: rule.subtitle,
    section: rule.section,
    relation: rule.relation,
    evidenceLevel: rule.evidenceLevel,
    confidence: Math.max(68, 88 - index * 4),
    description: rule.description,
    clauseIds: clauses.slice(0, 3).map((clause) => clause.id),
    companyIds: companyIdsByNodeId[rule.id] ?? [],
    iconKey: rule.id
  }));
  const chainEdges = chainNodes.slice(1).map((node) => ({
    from: chainNodes[0].id,
    to: node.id,
    type: node.relation === "约束风险" ? "risk" : "medium",
    confidence: node.confidence
  }));
  const confidence = estimateConfidence(policy, clauses, matchedRules);

  return {
    id: policy.external_id ?? policy.id,
    generatedAt,
    summary: {
      id: policy.external_id ?? policy.id,
      title: policy.title,
      issuer: policy.issuer ?? "未知机构",
      source: policy.source_name ?? "政策来源",
      publishDate: policy.publish_date ?? "",
      status: "published",
      confidence,
      industryCount: chainNodes.length,
      companyCount: companies.length,
      evidenceCount: evidence.length,
      primarySignal: chainNodes[0]?.title ?? "政策影响待细化",
      category: inferCategory(text)
    },
    policy: {
      title: policy.title,
      status: "已发布",
      issuer: policy.issuer ?? "未知机构",
      publishDate: policy.publish_date ?? "",
      effectiveDate: policy.effective_date ?? policy.publish_date ?? "",
      source: policy.source_name ?? "政策来源",
      category: inferCategory(text),
      level: policy.policy_level ?? "政策文件",
      confidence,
      scope: impactScope,
      impactScope,
      sourceUrl: policy.source_url ?? undefined,
      tags: matchedRules.map((rule) => rule.title)
    },
    actions,
    clauseGroups: [
      { id: "core", title: "核心条款", count: clauses.length, tone: "blue" },
      { id: "industry", title: "产业影响", count: chainNodes.length, tone: "green" },
      { id: "risk", title: "约束与待验证", count: matchedRules.filter((rule) => rule.relation === "约束风险").length, tone: "orange" }
    ],
    clauses,
    chainNodes,
    chainEdges,
    companies,
    evidence,
    backgroundCards: buildBackgroundCards(policy, text, evidence, impactScope),
    compareRows: [
      ["分析口径", "官方政策原文、条款、证据链", "与系统基准一致", "暂未接入用户自选对比项"],
      ["政策范围", impactScope, "以发布机关管辖范围判断", "需人工复核地方性政策边界"],
      ["产业影响", chainNodes.map((node) => node.title).slice(0, 4).join("、") || "尚未形成产业节点", "按命中产业词和条款映射", "公司映射为空时不生成公司结论"],
      ["证据基础", `${evidence.length} 条政策原文证据`, "保留原文摘录和来源 URL", "外部市场数据尚未自动接入"]
    ],
    modules: defaultModules(),
    topTabs: defaultTopTabs()
  };
}

function hasUsablePolicyText(value: string | null | undefined): boolean {
  return normalizeText(value ?? "").length >= MIN_POLICY_FULL_TEXT_LENGTH;
}

function matchIndustryRules(text: string): IndustryRule[] {
  const matched = INDUSTRY_RULES.filter((rule) =>
    rule.keywords.some((keyword) => text.includes(keyword))
  );

  return matched.length
    ? matched.slice(0, 6)
    : [{
        id: "implementation",
        title: "政策执行与公共服务",
        subtitle: "执行机制、公共治理、服务供给",
        section: "support",
        keywords: [],
        relation: "待验证",
        evidenceLevel: "待验证",
        description: "当前文本未命中特定产业词，需要结合人工复核或后续模型分析进一步判断产业影响。"
      }];
}

function buildCompanyCandidates(
  rules: IndustryRule[],
  clauses: ExtractedPolicyClause[],
  evidence: ReportEvidenceItem[]
): CompanyCandidate[] {
  const candidates = new Map<string, CompanyCandidate>();

  for (const [ruleIndex, rule] of rules.entries()) {
    const templates = COMPANY_CANDIDATE_TEMPLATES[rule.id] ?? [];
    if (templates.length === 0) continue;

    const relatedClauses = findRelatedClausesForRule(rule, clauses).slice(0, 3);
    if (relatedClauses.length === 0) continue;

    const clauseIds = relatedClauses.map((clause) => clause.id);
    const evidenceIds = evidence
      .filter((item) => item.clauseIds.some((clauseId) => clauseIds.includes(clauseId)))
      .slice(0, 3)
      .map((item) => item.id);
    if (evidenceIds.length === 0) continue;

    for (const [templateIndex, template] of templates.entries()) {
      const policyRelevance = estimateCompanyPolicyRelevance(rule, ruleIndex, templateIndex);
      const evidenceCertainty = estimateCompanyEvidenceCertainty(rule, ruleIndex, evidenceIds.length);
      const confidence = clampScoreValue(policyRelevance * 0.55 + evidenceCertainty * 0.45);
      const existing = candidates.get(template.id);

      if (existing) {
        existing.nodeIds = uniqueStrings([...existing.nodeIds, rule.id]);
        existing.clauseIds = uniqueStrings([...existing.clauseIds, ...clauseIds]);
        existing.evidenceIds = uniqueStrings([...existing.evidenceIds, ...evidenceIds]);
        existing.evidenceCount = existing.evidenceIds.length;
        existing.products = uniqueStrings([...existing.products, ...template.products]).slice(0, 6);
        existing.policyRelevance = Math.max(existing.policyRelevance, policyRelevance);
        existing.evidenceCertainty = Math.max(existing.evidenceCertainty, evidenceCertainty);
        existing.confidence = Math.max(existing.confidence, confidence);
        existing.reason = buildCandidateReason(
          template,
          rules.filter((item) => existing.nodeIds.includes(item.id)),
          existing.evidenceCount
        );
        existing.uncertainty = buildCandidateUncertainty();
        continue;
      }

      if (candidates.size >= 8) break;

      candidates.set(template.id, {
        id: template.id,
        name: template.name,
        ticker: template.ticker,
        platform: template.platform,
        status: template.status,
        section: rule.section,
        relation: rule.relation,
        evidence: rule.evidenceLevel,
        evidenceLevel: rule.evidenceLevel,
        confidence,
        policyRelevance,
        evidenceCertainty,
        evidenceCount: evidenceIds.length,
        products: template.products,
        nodeIds: [rule.id],
        clauseIds,
        evidenceIds,
        reason: buildCandidateReason(template, [rule], evidenceIds.length),
        uncertainty: buildCandidateUncertainty()
      });
    }

    if (candidates.size >= 8) break;
  }

  return Array.from(candidates.values()).slice(0, 8);
}

function buildCompanyIdsByNodeId(companies: CompanyCandidate[]): Record<string, string[]> {
  return companies.reduce<Record<string, string[]>>((acc, company) => {
    for (const nodeId of company.nodeIds) {
      acc[nodeId] = [...(acc[nodeId] ?? []), company.id];
    }
    return acc;
  }, {});
}

function findRelatedClausesForRule(rule: IndustryRule, clauses: ExtractedPolicyClause[]): ExtractedPolicyClause[] {
  const keywords = rule.keywords.map((keyword) => keyword.trim()).filter(Boolean);
  if (keywords.length === 0) return [];

  return clauses.filter((clause) => {
    const haystack = [
      clause.title,
      clause.excerpt,
      clause.fullText,
      clause.keywords.join(" "),
      clause.industries.join(" ")
    ].join("\n");
    const lowerHaystack = haystack.toLowerCase();

    return clause.industries.includes(rule.title)
      || keywords.some((keyword) => lowerHaystack.includes(keyword.toLowerCase()));
  });
}

function estimateCompanyPolicyRelevance(rule: IndustryRule, ruleIndex: number, templateIndex: number): number {
  const base = rule.relation === "直接相关"
    ? 82
    : rule.relation === "潜在受益"
      ? 76
      : rule.relation === "约束风险"
        ? 72
        : rule.relation === "间接相关"
          ? 70
          : 60;

  return clampScoreValue(base - ruleIndex * 3 - templateIndex * 2);
}

function estimateCompanyEvidenceCertainty(rule: IndustryRule, ruleIndex: number, evidenceCount: number): number {
  const base = rule.evidenceLevel === "强证据"
    ? 64
    : rule.evidenceLevel === "间接证据"
      ? 56
      : 48;

  return Math.min(78, clampScoreValue(base + Math.min(evidenceCount, 3) * 4 - ruleIndex * 2));
}

function buildCandidateReason(
  template: CompanyCandidateTemplate,
  rules: IndustryRule[],
  evidenceCount: number
): string {
  const ruleTitles = rules.map((rule) => rule.title).join("、");
  const productLabels = template.products.join("、");
  return `${CANDIDATE_MAPPING_NOTE} 命中产业规则：${ruleTitles}；候选主体公开业务标签包含：${productLabels}；关联政策文本证据 ${evidenceCount} 条。`;
}

function buildCandidateUncertainty(): string {
  return `${CANDIDATE_MAPPING_NOTE} 当前仅按文本关键词和业务标签做候选召回，未校验该主体的订单、收入占比、客户区域、政策执行进度或实际受益/受约束程度。`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function clampScoreValue(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function extractPolicyClauses(text: string): Array<{
  id: string;
  no: string;
  title: string;
  group: string;
  excerpt: string;
  fullText: string;
  confidence: number;
  keywords: string[];
  industries: string[];
}> {
  const normalized = normalizeText(text);
  const sentences = normalized
    .split(/(?<=[。；;])\s*|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 18)
    .slice(0, 6);

  const fallback = sentences.length ? sentences : [normalized.slice(0, 160) || "政策原文已入库，等待进一步结构化分析。"];

  return fallback.map((sentence, index) => ({
    id: `clause-${index + 1}`,
    no: `片段${index + 1}`,
    title: inferClauseTitle(sentence, index),
    group: "core",
    excerpt: sentence.slice(0, 180),
    fullText: sentence,
    confidence: Math.max(70, 92 - index * 3),
    keywords: extractKeywords(sentence),
    industries: matchIndustryRules(sentence).slice(0, 3).map((rule) => rule.title)
  }));
}

function buildActions(rules: IndustryRule[], clauses: ReturnType<typeof extractPolicyClauses>) {
  return rules.slice(0, 4).map((rule, index) => ({
    id: `action-${index + 1}`,
    title: rule.title,
    body: clauses[index]?.excerpt ?? rule.description,
    signal: rule.relation === "约束风险" ? "约束" : rule.relation === "待验证" ? "待验证" : "利好",
    confidence: Math.max(68, 88 - index * 5),
    clauseIds: clauses[index] ? [clauses[index].id] : [],
    sortOrder: index
  }));
}

function inferImpactScope(policy: PolicyRecord): string {
  const text = `${policy.title} ${policy.issuer ?? ""} ${policy.policy_level ?? ""} ${policy.source_name ?? ""}`;
  const provinceMatch = text.match(/(北京市|天津市|上海市|重庆市|河北省|山西省|辽宁省|吉林省|黑龙江省|江苏省|浙江省|安徽省|福建省|江西省|山东省|河南省|湖北省|湖南省|广东省|海南省|四川省|贵州省|云南省|陕西省|甘肃省|青海省|台湾省|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|香港特别行政区|澳门特别行政区)/);
  if (provinceMatch) return provinceMatch[1];
  if (/国务院|中共中央|全国|国家|中国政府网|国家发展改革委|国家数据局|工业和信息化部|部委/.test(text)) return "全国";
  return "以政策发布机关管辖范围为准";
}

function buildBackgroundCards(policy: PolicyRecord, text: string, evidence: Array<{ id: string }>, impactScope: string) {
  const matchedDirections = matchIndustryRules(text).map((rule) => rule.title).join("、") || "尚未命中明确产业方向";

  return [
    {
      id: "source",
      title: "政策来源",
      body: `${policy.source_name ?? "官方来源"}发布，系统已保存政策原文并建立证据索引。`,
      evidenceIds: evidence.slice(0, 1).map((item) => item.id)
    },
    {
      id: "scope",
      title: "影响范围",
      body: `本政策影响范围判断为：${impactScope}。产业方向另行展示为：${matchedDirections}。`,
      evidenceIds: evidence.slice(0, 3).map((item) => item.id)
    },
    {
      id: "method",
      title: "分析方法",
      body: "当前为规则驱动的基础自动分析，适合上线后形成可读报表；深度产业链和公司研判可在后续接入模型分析。",
      evidenceIds: []
    }
  ];
}

function estimateConfidence(policy: PolicyRecord, clauses: unknown[], rules: unknown[]): number {
  let score = 62;
  if (policy.source_url) score += 6;
  if ((policy.full_text?.length ?? 0) > 500) score += 12;
  if (clauses.length >= 3) score += 8;
  if (rules.length >= 2) score += 8;
  return Math.min(score, 90);
}

function inferCategory(text: string): string {
  if (/条例|规定|办法/.test(text)) return "法规规章";
  if (/通知/.test(text)) return "通知";
  if (/意见/.test(text)) return "意见";
  if (/公告/.test(text)) return "公告";
  return "政策文件";
}

function inferClauseTitle(sentence: string, index: number): string {
  const keyword = extractKeywords(sentence)[0];
  return keyword ? `${keyword}相关要求` : `核心片段${index + 1}`;
}

function extractKeywords(text: string): string[] {
  const keywords = [
    "人工智能",
    "数据",
    "能源",
    "安全",
    "监管",
    "标准",
    "平台",
    "产业",
    "企业",
    "创新",
    "绿色",
    "制造"
  ];
  return keywords.filter((keyword) => text.includes(keyword)).slice(0, 4);
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function defaultModules() {
  return [
    { id: "brief", label: "政策速读" },
    { id: "industry", label: "产业链影响" },
    { id: "clauses", label: "政策条款" },
    { id: "background", label: "政策背景" },
    { id: "compare", label: "对比分析" },
    { id: "companies", label: "公司影响分析" },
    { id: "evidence", label: "证据链总览" }
  ];
}

function defaultTopTabs() {
  return [
    { id: "brief", label: "政策总览" },
    { id: "clauses", label: "政策条款" },
    { id: "background", label: "政策背景" },
    { id: "compare", label: "对比分析" }
  ];
}
