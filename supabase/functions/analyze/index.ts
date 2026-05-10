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
  const text = normalizeText(`${policy.title}\n${policy.summary ?? ""}\n${policy.full_text ?? ""}`);
  const matchedRules = matchIndustryRules(text);
  const clauses = extractPolicyClauses(policy.full_text ?? policy.summary ?? policy.title);
  const evidence = clauses.map((clause, index) => ({
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
    companyIds: []
  }));
  const actions = buildActions(matchedRules, clauses);
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
    companyIds: [],
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
      companyCount: 0,
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
    companies: [],
    evidence,
    backgroundCards: buildBackgroundCards(policy, text, evidence),
    compareRows: [
      ["分析口径", "本次自动分析", "后续深度分析"],
      ["政策来源", "官方政策原文", "可叠加部门解读与行业数据"],
      ["公司覆盖", "暂不自动生成公司结论", "后续接入公司库后扩展"]
    ],
    modules: defaultModules(),
    topTabs: defaultTopTabs()
  };
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

function buildBackgroundCards(policy: PolicyRecord, text: string, evidence: Array<{ id: string }>) {
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
      body: `${matchIndustryRules(text).map((rule) => rule.title).join("、")} 是当前文本命中的主要影响方向。`,
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
