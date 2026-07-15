import {
  errorResponse,
  handleOptions,
  HttpError,
  isRecord,
  jsonResponse,
  optionalString,
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
  status: string | null;
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
const DEFAULT_BATCH_REANALYZE_LIMIT = 5;
const MAX_BATCH_REANALYZE_LIMIT = 100;
const POLICY_MIN_PUBLISH_DATE = "2026-05-01";
const MANUAL_ANALYSIS_VERSION = "codex-manual-v1";

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

type MatchedIndustryRule = IndustryRule & {
  matchedKeywords: string[];
  matchScore: number;
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
  },
  {
    id: "semiconductor",
    title: "半导体与关键元器件",
    subtitle: "芯片、集成电路、关键设备材料",
    section: "upstream",
    keywords: ["半导体", "芯片", "集成电路", "关键元器件", "EDA", "晶圆", "先进封装", "材料"],
    relation: "潜在受益",
    evidenceLevel: "间接证据",
    description: "政策文本命中芯片、集成电路或关键元器件方向，可能对应关键技术攻关、供应链韧性和国产替代相关需求。"
  },
  {
    id: "robotics",
    title: "机器人与智能装备",
    subtitle: "机器人、自动化、智能装备系统",
    section: "midstream",
    keywords: ["机器人", "自动化", "智能装备", "数控", "工控", "无人装备", "工业母机"],
    relation: "间接相关",
    evidenceLevel: "间接证据",
    description: "政策文本涉及机器人、自动化或智能装备场景，可能影响装备升级、产线改造和系统集成需求。"
  },
  {
    id: "biomedicine",
    title: "生物医药与医疗健康",
    subtitle: "医药、医疗器械、公共卫生、健康服务",
    section: "downstream",
    keywords: ["医药", "生物医药", "医疗", "医疗器械", "医院", "公共卫生", "健康", "药品"],
    relation: "直接相关",
    evidenceLevel: "强证据",
    description: "政策文本直接涉及医药、医疗服务或公共卫生，相关主体需要关注准入、采购、研发和服务供给变化。"
  },
  {
    id: "finance",
    title: "金融科技与数字金融",
    subtitle: "金融服务、支付、征信、风控、普惠金融",
    section: "support",
    keywords: ["金融", "支付", "征信", "风控", "普惠金融", "保险", "银行", "资本市场"],
    relation: "约束风险",
    evidenceLevel: "间接证据",
    description: "政策文本涉及金融服务或风控合规，可能带来金融科技系统改造、合规治理或服务模式调整。"
  },
  {
    id: "transport",
    title: "交通物流与供应链",
    subtitle: "交通、物流、仓储、供应链协同",
    section: "downstream",
    keywords: ["交通", "物流", "仓储", "供应链", "冷链", "港口", "铁路", "公路", "航空"],
    relation: "间接相关",
    evidenceLevel: "间接证据",
    description: "政策文本涉及交通物流或供应链协同，可能影响物流网络、仓储调度和供应链数字化需求。"
  },
  {
    id: "agriculture",
    title: "农业与乡村产业",
    subtitle: "农业生产、种业、农机、乡村振兴",
    section: "downstream",
    keywords: ["农业", "种业", "农机", "粮食", "乡村振兴", "农产品", "耕地", "智慧农业"],
    relation: "直接相关",
    evidenceLevel: "强证据",
    description: "政策文本涉及农业、粮食安全或乡村产业，相关环节可能受到生产、流通、科技和补贴政策影响。"
  },
  {
    id: "education",
    title: "教育科技与人才培养",
    subtitle: "教育、培训、职业技能、人才供给",
    section: "support",
    keywords: ["教育", "培训", "职业教育", "人才", "高校", "课程", "技能", "产教融合"],
    relation: "间接相关",
    evidenceLevel: "间接证据",
    description: "政策文本涉及教育培训或人才供给，可能影响职业教育、数字化教学和产业人才培养服务。"
  }
];

const CANDIDATE_MAPPING_NOTE = "基于政策文本关键词与公开业务标签的候选映射，不构成公司持续跟踪或投资结论。";

const ACTION_KEYWORDS = [
  "支持",
  "鼓励",
  "推动",
  "推进",
  "加快",
  "加强",
  "建立",
  "完善",
  "规范",
  "引导",
  "促进",
  "培育",
  "建设",
  "实施",
  "开展",
  "提升",
  "优化",
  "强化",
  "落实",
  "禁止",
  "不得",
  "严格",
  "严禁",
  "审查",
  "监管"
];

const CONSTRAINT_ACTION_KEYWORDS = ["禁止", "不得", "严禁", "严格", "监管", "审查", "规范", "合规", "风险"];
const SUPPORT_ACTION_KEYWORDS = ["支持", "鼓励", "促进", "培育", "加快", "推动", "推进", "建设", "提升", "优化"];
const IMPLEMENTATION_ACTION_KEYWORDS = ["建立", "完善", "实施", "开展", "落实", "加强", "强化", "引导"];

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
  score: number;
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

type ComparablePolicyFetchResult = {
  status: "ready" | "query_error";
  policies: PolicyRecord[];
  message?: string;
};

type PolicyFingerprint = {
  keywords: string[];
  ruleIds: string[];
  ruleTitles: string[];
  category: string;
  issuer: string;
  actionLabels: string[];
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
  ],
  semiconductor: [
    {
      id: "candidate-smic",
      name: "中芯国际",
      ticker: "688981.SH / 0981.HK",
      platform: "晶圆代工、集成电路制造与半导体产业链配套",
      status: "代表性上市公司候选",
      products: ["晶圆代工", "集成电路制造", "成熟制程"]
    },
    {
      id: "candidate-naura",
      name: "北方华创",
      ticker: "002371.SZ",
      platform: "半导体设备、真空装备与电子工艺装备",
      status: "代表性上市公司候选",
      products: ["刻蚀设备", "薄膜沉积设备", "电子工艺装备"]
    }
  ],
  robotics: [
    {
      id: "candidate-inovance",
      name: "汇川技术",
      ticker: "300124.SZ",
      platform: "工业自动化控制、伺服系统与智能制造装备",
      status: "代表性上市公司候选",
      products: ["工业自动化", "伺服系统", "新能源汽车电控"]
    },
    {
      id: "candidate-estun",
      name: "埃斯顿",
      ticker: "002747.SZ",
      platform: "工业机器人、运动控制与智能制造系统",
      status: "代表性上市公司候选",
      products: ["工业机器人", "运动控制", "智能制造系统"]
    }
  ],
  biomedicine: [
    {
      id: "candidate-mindray",
      name: "迈瑞医疗",
      ticker: "300760.SZ",
      platform: "医疗器械、生命信息支持与体外诊断",
      status: "代表性上市公司候选",
      products: ["医疗器械", "生命信息支持", "体外诊断"]
    },
    {
      id: "candidate-winning-health",
      name: "卫宁健康",
      ticker: "300253.SZ",
      platform: "医疗信息化、医院核心系统与区域健康平台",
      status: "代表性上市公司候选",
      products: ["医疗信息化", "医院信息系统", "区域健康平台"]
    }
  ],
  finance: [
    {
      id: "candidate-hundsun",
      name: "恒生电子",
      ticker: "600570.SH",
      platform: "金融 IT、资本市场核心系统与风控合规服务",
      status: "代表性上市公司候选",
      products: ["金融 IT", "交易系统", "风控合规"]
    },
    {
      id: "candidate-ant-digital",
      name: "蚂蚁数科",
      ticker: "未上市机构",
      platform: "数字金融技术、支付技术与风控科技服务",
      status: "代表性平台型机构候选",
      products: ["支付技术", "风控科技", "数字金融技术"]
    }
  ],
  transport: [
    {
      id: "candidate-sf",
      name: "顺丰控股",
      ticker: "002352.SZ",
      platform: "综合物流、冷链、供应链与快递网络",
      status: "代表性上市公司候选",
      products: ["快递物流", "冷链物流", "供应链服务"]
    },
    {
      id: "candidate-jd-logistics",
      name: "京东物流",
      ticker: "2618.HK",
      platform: "一体化供应链物流、仓配网络与物流技术",
      status: "代表性上市公司候选",
      products: ["供应链物流", "仓配网络", "物流技术"]
    }
  ],
  agriculture: [
    {
      id: "candidate-yuan-longping",
      name: "隆平高科",
      ticker: "000998.SZ",
      platform: "种业研发、农作物种子与农业科技服务",
      status: "代表性上市公司候选",
      products: ["种业", "农作物种子", "农业科技"]
    },
    {
      id: "candidate-dabeinong",
      name: "大北农",
      ticker: "002385.SZ",
      platform: "饲料、种业、生猪养殖与农业科技服务",
      status: "代表性上市公司候选",
      products: ["饲料", "种业", "农业科技"]
    }
  ],
  education: [
    {
      id: "candidate-keda-xunfei-edu",
      name: "科大讯飞教育",
      ticker: "002230.SZ",
      platform: "智慧教育、学习机、教育大模型与因材施教平台",
      status: "代表性上市公司业务候选",
      products: ["智慧教育", "教育大模型", "学习终端"]
    },
    {
      id: "candidate-china-east-education",
      name: "中国东方教育",
      ticker: "0667.HK",
      platform: "职业教育、技能培训与产教融合服务",
      status: "代表性上市公司候选",
      products: ["职业教育", "技能培训", "产教融合"]
    }
  ]
};

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    requirePost(req);

    const supabase = createSupabaseAdminClient();
    const actor = await requireCrawlerOrAdminUser(req, supabase);
    const body = await readJsonObject(req);
    if (body.setManualReviewDisposition === true || body.set_manual_review_disposition === true) {
      const result = await setManualReviewDisposition(supabase, actor.id, body);
      return jsonResponse(result);
    }

    if (body.listPendingManualAnalysis === true || body.list_pending_manual_analysis === true) {
      const sincePublishDate = readSincePublishDate(body);
      const limit = clampBatchLimit(body.limit);
      const result = await listPendingManualAnalysisPolicies(supabase, sincePublishDate, limit);
      return jsonResponse(result);
    }

    if (body.getNextSelectedManualAnalysis === true || body.get_next_selected_manual_analysis === true) {
      const sincePublishDate = readSincePublishDate(body);
      const result = await getNextSelectedManualAnalysis(supabase, sincePublishDate);
      return jsonResponse(result);
    }

    if (body.getManualAnalysisPolicy === true || body.get_manual_analysis_policy === true) {
      const result = await getManualAnalysisPolicy(supabase, body);
      return jsonResponse(result);
    }

    if (body.applyManualAnalysis === true || body.apply_manual_analysis === true) {
      const result = await applyManualAnalysisReport(supabase, body);
      return jsonResponse(result);
    }

    if (body.reanalyzePublished === true || body.reanalyze_published === true) {
      requireRulesAnalysisOptIn(body);
      const limit = clampBatchLimit(body.limit);
      const offset = clampBatchOffset(body.offset);
      const sincePublishDate = readSincePublishDate(body);
      const result = await reanalyzePublishedPolicies(supabase, limit, offset, sincePublishDate);
      return jsonResponse(result);
    }

    const requestedPolicyId = optionalString(body, "policyId") ?? optionalString(body, "policy_id");
    if (requestedPolicyId) {
      requireRulesAnalysisOptIn(body);
      const now = new Date().toISOString();
      const policy = await fetchPolicy(supabase, requestedPolicyId);
      requirePolicyInManualScope(policy);
      if (!hasUsablePolicyText(policy.full_text)) {
        throw new HttpError(
          409,
          "Policy full_text is missing or too short. Scheduled analysis requires the original policy text, not only title or summary metadata."
        );
      }

      const comparablePolicies = await fetchComparablePolicies(supabase, policy.id);
      const reportPayload = buildReportPayload(policy, now, comparablePolicies);
      const analysisOutput = {
        analyzerVersion: "rules-v0.2",
        analyzedAt: now,
        status: "analysis_complete",
        reportPayload,
        fullTextLength: policy.full_text?.length ?? 0,
        reanalysis: true
      };
      await updatePolicyAnalysisMetadata(supabase, policy, reportPayload, analysisOutput);

      return jsonResponse({
        policyId: policy.id,
        analysis: analysisOutput,
        reanalyzed: true
      });
    }

    requireRulesAnalysisOptIn(body);
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
    requirePolicyInManualScope(policy);
    if (!hasUsablePolicyText(policy.full_text)) {
      throw new HttpError(
        409,
        "Policy full_text is missing or too short. Scheduled analysis requires the original policy text, not only title or summary metadata."
      );
    }

    const comparablePolicies = await fetchComparablePolicies(supabase, job.policy_id);
    const reportPayload = buildReportPayload(policy, now, comparablePolicies);
    const analysisOutput = {
      analyzerVersion: "rules-v0.2",
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
        current_step: "已生成政策产业链、公司候选与对比基准分析，等待发布",
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

    await updatePolicyAnalysisMetadata(supabase, policy, reportPayload, analysisOutput, "reviewing");

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
    .select("id,external_id,title,status,issuer,publish_date,effective_date,source_name,source_url,category,policy_level,confidence,summary,full_text,metadata")
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

function clampBatchLimit(value: unknown): number {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : DEFAULT_BATCH_REANALYZE_LIMIT;

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_BATCH_REANALYZE_LIMIT;
  }

  return Math.max(1, Math.min(MAX_BATCH_REANALYZE_LIMIT, Math.floor(numericValue)));
}

function clampBatchOffset(value: unknown): number {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.floor(numericValue));
}

function readSincePublishDate(body: Record<string, unknown>): string {
  return optionalString(body, "sincePublishDate") ??
    optionalString(body, "since_publish_date") ??
    optionalString(body, "since") ??
    POLICY_MIN_PUBLISH_DATE;
}

function requireRulesAnalysisOptIn(body: Record<string, unknown>): void {
  const serverAllowsRulesAnalysis = Deno.env.get("ALLOW_RULES_ANALYSIS") === "true";
  const requestAllowsRulesAnalysis = body.allowRulesAnalysis === true || body.allow_rules_analysis === true;
  if (serverAllowsRulesAnalysis && requestAllowsRulesAnalysis) {
    return;
  }

  throw new HttpError(
    410,
    "Automatic rules analysis is disabled in production. A user must explicitly select the policy, then an Agent reads the original text and applies the reviewed analysis."
  );
}

function requirePolicyInManualScope(policy: PolicyRecord): void {
  if (!policy.publish_date || policy.publish_date < POLICY_MIN_PUBLISH_DATE) {
    throw new HttpError(
      409,
      `Policy is outside the active system scope. Only policies published on or after ${POLICY_MIN_PUBLISH_DATE} are analyzed.`
    );
  }

  if (!["draft", "reviewing", "published"].includes(policy.status ?? "")) {
    throw new HttpError(409, `Policy status "${policy.status ?? "unknown"}" cannot be manually analyzed or published.`);
  }
}

type ManualReviewDisposition =
  | "pending_review"
  | "awaiting_evidence"
  | "selected_for_analysis"
  | "quick_archived"
  | "dismissed";

async function setManualReviewDisposition(
  supabase: SupabaseAdminClient,
  actorId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const policyId = optionalString(body, "policyId") ?? optionalString(body, "policy_id");
  if (!policyId) throw new HttpError(400, "Missing required string field: policyId");

  const disposition = normalizeManualReviewDisposition(
    optionalString(body, "disposition") ??
    optionalString(body, "manualReviewDisposition") ??
    optionalString(body, "manual_review_disposition")
  );
  if (!disposition) {
    throw new HttpError(400, "Invalid manual review disposition.");
  }

  const reason = optionalString(body, "reason") ??
    optionalString(body, "manualReviewReason") ??
    optionalString(body, "manual_review_reason");
  if (["awaiting_evidence", "quick_archived", "dismissed"].includes(disposition) && (!reason || reason.length < 4)) {
    throw new HttpError(400, `${disposition} requires a review reason of at least 4 characters.`);
  }

  const policy = await fetchPolicy(supabase, policyId);
  requirePolicyInManualScope(policy);
  const existingMetadata = isRecord(policy.metadata) ? policy.metadata : {};
  const alreadyComplete = policy.status === "published" && (
    readRecordString(existingMetadata, "analysisMethod") === MANUAL_ANALYSIS_VERSION ||
    readRecordString(existingMetadata, "analysis_method") === MANUAL_ANALYSIS_VERSION ||
    readRecordString(existingMetadata, "manualReviewDisposition") === "analysis_complete" ||
    readRecordString(existingMetadata, "manual_review_disposition") === "analysis_complete"
  );
  if (alreadyComplete) throw new HttpError(409, "Agent analysis is already complete for this policy.");

  const openStatuses = ["queued", "fetching", "extracting", "analyzing"];
  const { data: existingJob, error: existingJobError } = await supabase
    .from("analysis_jobs")
    .select("id,policy_id,title,source_url,source_name,status,progress,created_at,current_step")
    .eq("policy_id", policy.id)
    .in("status", openStatuses)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingJobError) throw existingJobError;

  if (disposition !== "selected_for_analysis" && existingJob) {
    throw new HttpError(409, "An open analysis job exists. Complete or fail it before changing disposition.");
  }

  const now = new Date().toISOString();
  let job = existingJob as Record<string, unknown> | null;
  if (disposition === "selected_for_analysis" && !job) {
    const { data, error } = await supabase
      .from("analysis_jobs")
      .insert({
        policy_id: policy.id,
        owner_id: actorId,
        title: policy.title,
        source_url: policy.source_url,
        source_name: policy.source_name,
        status: "queued",
        progress: 8,
        current_step: "Explicitly selected for Agent analysis",
        input_payload: {
          trigger: "user_explicit_selection",
          policyId: policy.id,
          selectedBy: actorId,
          selectedAt: now
        }
      })
      .select("id,policy_id,title,source_url,source_name,status,progress,created_at,current_step")
      .single();
    if (error || !data) throw error ?? new Error("Analysis job insert returned no row.");
    job = data as Record<string, unknown>;
  }

  const selected = disposition === "selected_for_analysis";
  const requiresAnalysis = disposition === "pending_review" || selected;
  const metadata = {
    ...existingMetadata,
    manualAnalysisEligible: true,
    manual_analysis_eligible: true,
    requiresManualAnalysis: requiresAnalysis,
    requires_manual_analysis: requiresAnalysis,
    analysisQueueSelected: selected,
    analysis_queue_selected: selected,
    queueDeferred: disposition === "awaiting_evidence",
    queue_deferred: disposition === "awaiting_evidence",
    manualReviewDisposition: disposition,
    manual_review_disposition: disposition,
    manualReviewReason: reason ?? null,
    manual_review_reason: reason ?? null,
    manualReviewUpdatedAt: now,
    manual_review_updated_at: now,
    manualReviewUpdatedBy: actorId,
    manual_review_updated_by: actorId
  };

  const updateValues: Record<string, unknown> = { metadata };
  if (selected && policy.status === "draft") updateValues.status = "reviewing";
  const { error: updateError } = await supabase.from("policies").update(updateValues).eq("id", policy.id);
  if (updateError) throw updateError;

  return {
    mode: "setManualReviewDisposition",
    policyId: policy.id,
    disposition,
    reason: reason ?? null,
    job,
    next: selected ? ["getNextSelectedManualAnalysis", "applyManualAnalysis"] : []
  };
}

function normalizeManualReviewDisposition(value: string | null): ManualReviewDisposition | null {
  const allowed: ManualReviewDisposition[] = [
    "pending_review",
    "awaiting_evidence",
    "selected_for_analysis",
    "quick_archived",
    "dismissed"
  ];
  return allowed.includes(value as ManualReviewDisposition) ? value as ManualReviewDisposition : null;
}

async function getNextSelectedManualAnalysis(
  supabase: SupabaseAdminClient,
  sincePublishDate: string
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("policies")
    .select("id,metadata,publish_date,created_at")
    .gte("publish_date", sincePublishDate)
    .not("publish_date", "is", null)
    .order("publish_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new HttpError(500, "Failed to locate selected policy.", error);

  const selected = (Array.isArray(data) ? data : [])
    .map((item: unknown) => {
      const record = item as { id?: unknown; metadata?: unknown; publish_date?: unknown; created_at?: unknown };
      const metadata = isRecord(record.metadata) ? record.metadata : {};
      const disposition = readRecordString(metadata, "manualReviewDisposition") ??
        readRecordString(metadata, "manual_review_disposition");
      return {
        id: typeof record.id === "string" ? record.id : null,
        disposition,
        reviewPriority: readRecordNumber(metadata, "reviewPriority") ?? readRecordNumber(metadata, "review_priority") ?? 0,
        publishDate: typeof record.publish_date === "string" ? record.publish_date : "",
        createdAt: typeof record.created_at === "string" ? record.created_at : ""
      };
    })
    .filter((item) => item.id && item.disposition === "selected_for_analysis")
    .sort((a, b) => b.reviewPriority - a.reviewPriority || b.publishDate.localeCompare(a.publishDate) || b.createdAt.localeCompare(a.createdAt))[0];

  if (!selected?.id) {
    return {
      mode: "getNextSelectedManualAnalysis",
      selected: false,
      policy: null,
      job: null,
      message: "No explicitly selected policy is waiting for Agent analysis."
    };
  }

  const policy = await fetchPolicy(supabase, selected.id);
  const { data: job, error: jobError } = await supabase
    .from("analysis_jobs")
    .select("id,policy_id,title,source_url,source_name,status,progress,created_at,current_step")
    .eq("policy_id", policy.id)
    .in("status", ["queued", "fetching", "extracting", "analyzing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobError) throw jobError;

  return {
    mode: "getNextSelectedManualAnalysis",
    selected: true,
    policy: {
      id: policy.id,
      externalId: policy.external_id,
      title: policy.title,
      issuer: policy.issuer,
      publishDate: policy.publish_date,
      effectiveDate: policy.effective_date,
      sourceName: policy.source_name,
      sourceUrl: policy.source_url,
      category: policy.category,
      policyLevel: policy.policy_level,
      summary: policy.summary,
      fullText: policy.full_text,
      fullTextLength: policy.full_text?.length ?? 0,
      reviewPriority: selected.reviewPriority
    },
    job: job ?? null,
    next: ["agent_analyze_original_text", "applyManualAnalysis"]
  };
}

async function listPendingManualAnalysisPolicies(
  supabase: SupabaseAdminClient,
  sincePublishDate: string,
  limit: number
): Promise<Record<string, unknown>> {
  const fetchLimit = Math.min(Math.max(limit * 8, 80), 400);
  const { data, error } = await supabase
    .from("policies")
    .select("id,external_id,title,issuer,publish_date,effective_date,source_name,source_url,category,policy_level,confidence,summary,full_text,metadata,status,analysis_version,created_at,updated_at")
    .gte("publish_date", sincePublishDate)
    .not("publish_date", "is", null)
    .order("publish_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (error) {
    throw new HttpError(500, "Failed to list policies pending manual analysis.", error);
  }

  const activePolicies = (Array.isArray(data) ? data : [])
    .map((item: unknown) => {
      const record = item as PolicyRecord & {
        status?: string | null;
        analysis_version?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
      };
      const metadata = isRecord(record.metadata) ? record.metadata : {};
      const analysis = isRecord(metadata.analysis) ? metadata.analysis : {};
      const reportPayload = isRecord(metadata.reportPayload)
        ? metadata.reportPayload
        : isRecord(metadata.policyReport)
          ? metadata.policyReport
          : null;
      const analysisVersion = record.analysis_version ??
        readRecordString(analysis, "analyzerVersion") ??
        readRecordString(reportPayload, "analyzerVersion");
      const manual = analysisVersion === MANUAL_ANALYSIS_VERSION ||
        readRecordString(analysis, "analysisMethod") === MANUAL_ANALYSIS_VERSION;
      const analysisDepth = readRecordString(metadata, "analysisDepth") ??
        readRecordString(metadata, "analysis_depth") ??
        "L2";
      const explicitManualEligibility = readRecordBoolean(metadata, "manualAnalysisEligible") ??
        readRecordBoolean(metadata, "manual_analysis_eligible");
      const manualAnalysisEligible = explicitManualEligibility ?? ["L2", "L3"].includes(analysisDepth);
      const explicitDisposition = normalizeManualReviewDisposition(
        readRecordString(metadata, "manualReviewDisposition") ??
        readRecordString(metadata, "manual_review_disposition")
      );
      const queueSelected = readRecordBoolean(metadata, "analysisQueueSelected") ??
        readRecordBoolean(metadata, "analysis_queue_selected") ??
        false;
      const disposition = explicitDisposition ?? (queueSelected ? "selected_for_analysis" : "pending_review");
      const reviewPriority = readRecordNumber(metadata, "reviewPriority") ??
        readRecordNumber(metadata, "review_priority") ??
        0;
      const triageReasons = readStringArray(metadata.triageReasons ?? metadata.triage_reasons);
      const active = !manual &&
        manualAnalysisEligible &&
        ["L2", "L3"].includes(analysisDepth) &&
        !["quick_archived", "dismissed"].includes(disposition);

      return {
        id: record.id,
        externalId: record.external_id,
        title: record.title,
        issuer: record.issuer,
        publishDate: record.publish_date,
        sourceName: record.source_name,
        sourceUrl: record.source_url,
        status: record.status ?? "draft",
        analysisVersion,
        analysisDepth,
        reviewPriority,
        triageReasons,
        manualReviewDisposition: disposition,
        manualReviewReason: readRecordString(metadata, "manualReviewReason") ??
          readRecordString(metadata, "manual_review_reason"),
        analysisQueueSelected: disposition === "selected_for_analysis",
        queueDeferred: disposition === "awaiting_evidence",
        fullTextLength: record.full_text?.length ?? 0,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
        active
      };
    })
    .filter((item) => item.active)
    .sort((left, right) => {
      const stateRank: Record<string, number> = {
        selected_for_analysis: 0,
        pending_review: 1,
        awaiting_evidence: 2
      };
      return (stateRank[left.manualReviewDisposition] ?? 9) -
          (stateRank[right.manualReviewDisposition] ?? 9) ||
        right.reviewPriority - left.reviewPriority ||
        String(right.publishDate ?? "").localeCompare(String(left.publishDate ?? "")) ||
        String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
    });

  const stateCounts = {
    pendingReview: activePolicies.filter((item) => item.manualReviewDisposition === "pending_review").length,
    awaitingEvidence: activePolicies.filter((item) => item.manualReviewDisposition === "awaiting_evidence").length,
    selectedForAnalysis: activePolicies.filter((item) => item.manualReviewDisposition === "selected_for_analysis").length
  };
  const policies = activePolicies.slice(0, limit);

  return {
    mode: "listPendingManualAnalysis",
    sincePublishDate,
    scanned: Array.isArray(data) ? data.length : 0,
    total: activePolicies.length,
    count: policies.length,
    stateCounts,
    policies
  };
}

async function reanalyzePublishedPolicies(
  supabase: SupabaseAdminClient,
  limit: number,
  offset: number,
  sincePublishDate: string
): Promise<Record<string, unknown>> {
  const startedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("policies")
    .select("id,external_id,title,status,issuer,publish_date,effective_date,source_name,source_url,category,policy_level,confidence,summary,full_text,metadata")
    .eq("status", "published")
    .gte("publish_date", sincePublishDate)
    .not("publish_date", "is", null)
    .order("publish_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new HttpError(500, "Failed to list published policies for batch reanalysis.", error);
  }

  const policies = (Array.isArray(data) ? data : []).map((item: unknown) => {
    const record = item as PolicyRecord;
    return {
      ...record,
      metadata: isRecord(record.metadata) ? record.metadata : {}
    };
  });

  let reanalyzed = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const policy of policies) {
    try {
      if (!hasUsablePolicyText(policy.full_text)) {
        skipped += 1;
        results.push({
          policyId: policy.id,
          title: policy.title,
          status: "skipped",
          reason: "full_text_missing_or_too_short",
          fullTextLength: policy.full_text?.length ?? 0
        });
        continue;
      }

      const analyzedAt = new Date().toISOString();
      const comparablePolicies = await fetchComparablePolicies(supabase, policy.id);
      const reportPayload = buildReportPayload(policy, analyzedAt, comparablePolicies);
      const analysisOutput = {
        analyzerVersion: "rules-v0.2",
        analyzedAt,
        status: "analysis_complete",
        reportPayload,
        fullTextLength: policy.full_text?.length ?? 0,
        reanalysis: true,
        reanalysisMode: "published-batch"
      };

      await updatePolicyAnalysisMetadata(supabase, policy, reportPayload, analysisOutput);
      reanalyzed += 1;
      results.push({
        policyId: policy.id,
        title: policy.title,
        publishDate: policy.publish_date,
        status: "reanalyzed",
        chainNodeCount: reportPayload.chainNodes.length,
        companyCount: reportPayload.companies.length,
        evidenceCount: reportPayload.evidence.length,
        compareStatus: reportPayload.compareInsights.status,
        comparablePolicyCount: reportPayload.compareInsights.comparableCount
      });
    } catch (error) {
      failed += 1;
      results.push({
        policyId: policy.id,
        title: policy.title,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    reanalyzePublished: true,
    limit,
    offset,
    sincePublishDate,
    selected: policies.length,
    reanalyzed,
    skipped,
    failed,
    startedAt,
    finishedAt: new Date().toISOString(),
    results
  };
}

async function getManualAnalysisPolicy(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const policyId = optionalString(body, "policyId") ?? optionalString(body, "policy_id");
  if (!policyId) {
    throw new HttpError(400, "Missing required string field: policyId");
  }

  const policy = await fetchPolicy(supabase, policyId);
  requirePolicyInManualScope(policy);

  return {
    mode: "getManualAnalysisPolicy",
    policy: {
      id: policy.id,
      externalId: policy.external_id,
      title: policy.title,
      issuer: policy.issuer,
      publishDate: policy.publish_date,
      effectiveDate: policy.effective_date,
      sourceName: policy.source_name,
      sourceUrl: policy.source_url,
      category: policy.category,
      policyLevel: policy.policy_level,
      summary: policy.summary,
      fullText: policy.full_text,
      fullTextLength: policy.full_text?.length ?? 0
    }
  };
}

async function applyManualAnalysisReport(
  supabase: SupabaseAdminClient,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const policyId = optionalString(body, "policyId") ?? optionalString(body, "policy_id");
  if (!policyId) {
    throw new HttpError(400, "Missing required string field: policyId");
  }
  const reportPayloadInput = isRecord(body.reportPayload)
    ? body.reportPayload
    : isRecord(body.report_payload)
      ? body.report_payload
      : null;

  if (!reportPayloadInput) {
    throw new HttpError(400, "Missing required object field: reportPayload");
  }

  const policy = await fetchPolicy(supabase, policyId);
  requirePolicyInManualScope(policy);
  validateManualReportPayload(policy, reportPayloadInput);
  const now = new Date().toISOString();
  const reportPayload = normalizeManualReportPayload(policy, reportPayloadInput, now);
  const analysisOutput = {
    analyzerVersion: MANUAL_ANALYSIS_VERSION,
    analysisMethod: MANUAL_ANALYSIS_VERSION,
    analyzedAt: now,
    status: "analysis_complete",
    reportPayload,
    fullTextLength: policy.full_text?.length ?? 0,
    manual: true
  };

  await updatePolicyManualAnalysisMetadata(supabase, policy, reportPayload, analysisOutput);
  const jobUpdate = await markLatestAnalysisJobPublished(supabase, policy.id, now, analysisOutput);

  return {
    policyId: policy.id,
    analyzerVersion: MANUAL_ANALYSIS_VERSION,
    published: true,
    jobUpdated: jobUpdate.updated,
    jobId: jobUpdate.jobId,
    reportPayload
  };
}

function validateManualReportPayload(policy: PolicyRecord, input: Record<string, unknown>): void {
  const errors: string[] = [];
  const brief = isRecord(input.brief)
    ? input.brief
    : isRecord(input.policyBrief)
      ? input.policyBrief
      : isRecord(input.policy_brief)
        ? input.policy_brief
        : null;
  const analysisCoverage = isRecord(input.analysisCoverage)
    ? input.analysisCoverage
    : isRecord(input.analysis_coverage)
      ? input.analysis_coverage
      : null;
  const judgement = readRecordString(brief, "judgement") ?? "";
  const actions = arrayField(input.actions);
  const clauses = arrayField(input.clauses);
  const chainNodes = arrayField(input.chainNodes ?? input.chain_nodes);
  const companies = arrayField(input.companies);
  const evidence = arrayField(input.evidence);
  const backgroundCards = arrayField(input.backgroundCards ?? input.background_cards);
  const companyNoMatchReason =
    readRecordString(analysisCoverage, "companyImpactConclusion") ??
    readRecordString(analysisCoverage, "companyImpactReasoning") ??
    readRecordString(analysisCoverage, "companyNoMatchReason") ??
    readRecordString(input, "companyImpactConclusion") ??
    "";

  if (!hasUsablePolicyText(policy.full_text)) {
    errors.push("policy.full_text is missing or too short");
  }
  if (judgement.trim().length < 20) {
    errors.push("brief.judgement must contain a real manual conclusion");
  }
  if (actions.length < 2) {
    errors.push("actions must include at least 2 policy action analyses");
  }
  if (clauses.length < 2) {
    errors.push("clauses must include at least 2 interpreted policy clauses");
  }
  if (chainNodes.length < 1) {
    errors.push("chainNodes must include at least 1 industry-chain node or impact area");
  }
  if (companies.length < 1 && companyNoMatchReason.trim().length < 20) {
    errors.push("companies must include representative entities, or analysisCoverage must explain why no representative company is applicable");
  }
  if (evidence.length < 2) {
    errors.push("evidence must include at least 2 original-text or external evidence items");
  }
  if (backgroundCards.length < 1) {
    errors.push("backgroundCards must include at least 1 factual background item");
  }

  if (errors.length > 0) {
    throw new HttpError(400, `Manual report payload is incomplete: ${errors.join("; ")}.`);
  }
}

function normalizeManualReportPayload(
  policy: PolicyRecord,
  input: Record<string, unknown>,
  generatedAt: string
): Record<string, unknown> {
  const policyInput = isRecord(input.policy) ? input.policy : {};
  const summaryInput = isRecord(input.summary) ? input.summary : {};
  const clauses = arrayField(input.clauses);
  const chainNodes = arrayField(input.chainNodes ?? input.chain_nodes);
  const companies = arrayField(input.companies);
  const companyMap = arrayField(input.companyMap ?? input.company_map);
  const evidence = arrayField(input.evidence);
  const actions = arrayField(input.actions);
  const authoritativeCompanyCount = companyMap.length > 0 ? companyMap.length : companies.length;
  const confidence = clampScoreValue(readRecordNumber(summaryInput, "confidence") ?? readRecordNumber(policyInput, "confidence") ?? policy.confidence ?? 80);
  const category = readRecordString(policyInput, "category") ?? policy.category ?? inferCategory(buildPolicyAnalysisText(policy));

  return {
    ...input,
    id: policy.external_id ?? policy.id,
    generatedAt,
    analyzerVersion: MANUAL_ANALYSIS_VERSION,
    analysisMethod: MANUAL_ANALYSIS_VERSION,
    summary: {
      ...summaryInput,
      id: policy.external_id ?? policy.id,
      title: policy.title,
      issuer: policy.issuer ?? "未知机构",
      source: policy.source_name ?? "政策来源",
      publishDate: policy.publish_date ?? "",
      status: "published",
      confidence,
      industryCount: chainNodes.length,
      companyCount: authoritativeCompanyCount,
      evidenceCount: evidence.length,
      primarySignal: readRecordString(summaryInput, "primarySignal") ?? readRecordString(isRecord(input.brief) ? input.brief : null, "judgement") ?? "已完成人工智能大模型分析",
      category
    },
    policy: {
      ...policyInput,
      title: policy.title,
      status: "已发布",
      issuer: policy.issuer ?? "未知机构",
      publishDate: policy.publish_date ?? "",
      effectiveDate: policy.effective_date ?? policy.publish_date ?? "",
      source: policy.source_name ?? "政策来源",
      category,
      level: policy.policy_level ?? "政策文件",
      confidence,
      sourceUrl: policy.source_url ?? undefined,
      scope: readRecordString(policyInput, "scope") ?? inferImpactScope(policy),
      impactScope: readRecordString(policyInput, "impactScope") ?? readRecordString(policyInput, "impact_scope") ?? inferImpactScope(policy)
    },
    actions,
    clauses,
    chainNodes,
    chainEdges: arrayField(input.chainEdges ?? input.chain_edges),
    companies,
    evidence,
    clauseGroups: arrayField(input.clauseGroups ?? input.clause_groups),
    backgroundCards: arrayField(input.backgroundCards ?? input.background_cards),
    compareRows: arrayField(input.compareRows ?? input.compare_rows),
    compareInsights: isRecord(input.compareInsights) ? input.compareInsights : isRecord(input.compare_insights) ? input.compare_insights : undefined,
    analysisCoverage: isRecord(input.analysisCoverage)
      ? { ...input.analysisCoverage, companyCount: authoritativeCompanyCount }
      : isRecord(input.analysis_coverage)
        ? { ...input.analysis_coverage, companyCount: authoritativeCompanyCount }
        : undefined,
    modules: arrayField(input.modules).length ? arrayField(input.modules) : defaultModules(),
    topTabs: arrayField(input.topTabs ?? input.top_tabs).length ? arrayField(input.topTabs ?? input.top_tabs) : defaultTopTabs()
  };
}

async function updatePolicyManualAnalysisMetadata(
  supabase: SupabaseAdminClient,
  policy: PolicyRecord,
  reportPayload: Record<string, unknown>,
  analysisOutput: Record<string, unknown>
): Promise<void> {
  const existingPolicyMetadata = isRecord(policy.metadata) ? policy.metadata : {};
  const summary = isRecord(reportPayload.summary) ? reportPayload.summary : {};
  const policyMeta = isRecord(reportPayload.policy) ? reportPayload.policy : {};
  const { error } = await supabase
    .from("policies")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      analysis_version: MANUAL_ANALYSIS_VERSION,
      confidence: readRecordNumber(summary, "confidence") ?? readRecordNumber(policyMeta, "confidence") ?? policy.confidence,
      category: readRecordString(policyMeta, "category") ?? policy.category,
      summary: readRecordString(isRecord(reportPayload.brief) ? reportPayload.brief : null, "judgement") ?? policy.summary,
      metadata: {
        ...existingPolicyMetadata,
        analysisMethod: MANUAL_ANALYSIS_VERSION,
        analysis_method: MANUAL_ANALYSIS_VERSION,
        manualAnalysisEligible: false,
        manual_analysis_eligible: false,
        requiresManualAnalysis: false,
        requires_manual_analysis: false,
        analysisQueueSelected: false,
        analysis_queue_selected: false,
        queueDeferred: false,
        queue_deferred: false,
        manualReviewDisposition: "analysis_complete",
        manual_review_disposition: "analysis_complete",
        manualReviewCompletedAt: new Date().toISOString(),
        manual_review_completed_at: new Date().toISOString(),
        analysis: analysisOutput,
        analysisStub: analysisOutput,
        reportPayload,
        policyReport: reportPayload,
        counts: {
          industryCount: arrayField(reportPayload.chainNodes ?? reportPayload.chain_nodes).length,
          companyCount: arrayField(reportPayload.companyMap ?? reportPayload.company_map).length || arrayField(reportPayload.companies).length,
          evidenceCount: arrayField(reportPayload.evidence).length,
          primarySignal: readRecordString(summary, "primarySignal") ?? readRecordString(isRecord(reportPayload.brief) ? reportPayload.brief : null, "judgement") ?? "已完成人工智能大模型分析"
        }
      }
    })
    .eq("id", policy.id);

  if (error) {
    throw error;
  }
}

async function markLatestAnalysisJobPublished(
  supabase: SupabaseAdminClient,
  policyId: string,
  now: string,
  analysisOutput: Record<string, unknown>
): Promise<{ updated: boolean; jobId?: string }> {
  const { data, error: selectError } = await supabase
    .from("analysis_jobs")
    .select("id,output_payload")
    .eq("policy_id", policyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (!data?.id) return { updated: false };

  const existingOutput = isRecord((data as { output_payload?: unknown }).output_payload)
    ? (data as { output_payload: Record<string, unknown> }).output_payload
    : {};

  const { error: updateError } = await supabase
    .from("analysis_jobs")
    .update({
      status: "published",
      progress: 100,
      current_step: "Agent analysis published after explicit user selection",
      finished_at: now,
      output_payload: {
        ...existingOutput,
        analysisStub: analysisOutput,
        analysis: analysisOutput,
        reportPayload: analysisOutput.reportPayload,
        publishedAt: now,
        publishedPolicyId: policyId
      },
      error_message: null
    })
    .eq("id", data.id);

  if (updateError) {
    throw updateError;
  }

  return { updated: true, jobId: data.id };
}

async function updatePolicyAnalysisMetadata(
  supabase: SupabaseAdminClient,
  policy: PolicyRecord,
  reportPayload: ReturnType<typeof buildReportPayload>,
  analysisOutput: Record<string, unknown>,
  status?: "reviewing"
): Promise<void> {
  const existingPolicyMetadata = isRecord(policy.metadata) ? policy.metadata : {};
  const updateValues: Record<string, unknown> = {
    analysis_version: "rules-v0.2",
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
        primarySignal: reportPayload.chainNodes[0]?.title ?? "待分析",
        comparablePolicyCount: reportPayload.compareInsights.comparableCount,
        similarPolicyCount: reportPayload.compareInsights.similarPolicies.length,
        contrastPolicyCount: reportPayload.compareInsights.contrastPolicies.length
      }
    }
  };

  if (status) {
    updateValues.status = status;
  }

  const { error } = await supabase
    .from("policies")
    .update(updateValues)
    .eq("id", policy.id);

  if (error) {
    throw error;
  }
}

async function fetchComparablePolicies(
  supabase: SupabaseAdminClient,
  currentPolicyId: string
): Promise<ComparablePolicyFetchResult> {
  const { data, error } = await supabase
    .from("policies")
    .select("id,external_id,title,status,issuer,publish_date,effective_date,source_name,source_url,category,policy_level,confidence,summary,full_text,metadata")
    .eq("status", "published")
    .gte("publish_date", POLICY_MIN_PUBLISH_DATE)
    .not("publish_date", "is", null)
    .neq("id", currentPolicyId)
    .limit(40);

  if (error) {
    return {
      status: "query_error",
      policies: [],
      message: error.message ?? "查询已发布政策失败，未生成可比基准。"
    };
  }

  const policies = (data ?? [])
    .map((item: unknown) => {
      const record = item as PolicyRecord;
      return {
        ...record,
        metadata: isRecord(record.metadata) ? record.metadata : {}
      };
    })
    .filter((item: PolicyRecord) => normalizeText(`${item.title}\n${item.summary ?? ""}\n${item.full_text ?? ""}`).length >= 40);

  return {
    status: "ready",
    policies
  };
}

function buildReportPayload(
  policy: PolicyRecord,
  generatedAt: string,
  comparablePolicies: ComparablePolicyFetchResult
) {
  const fullText = normalizeText(policy.full_text ?? "");
  const text = buildPolicyAnalysisText(policy);
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
    nodeIds: getClauseNodeIds(clause, matchedRules),
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
  const chainNodes = buildChainNodes(matchedRules, clauses, companyIdsByNodeId);
  const chainEdges = buildChainEdges(chainNodes);
  const confidence = estimateConfidence(policy, clauses, matchedRules);
  const inferredCategory = policy.category ?? inferCategory(text);
  const compareInsights = buildCompareInsights(
    policy,
    comparablePolicies,
    matchedRules,
    clauses,
    actions,
    chainNodes,
    evidence
  );
  const companyInsights = buildCompanyInsights(companies, matchedRules, clauses);
  const analysisCoverage = buildAnalysisCoverage({
    policy,
    matchedRules,
    clauses,
    actions,
    companies,
    evidence,
    compareInsights,
    comparablePolicies
  });

  return {
    id: policy.external_id ?? policy.id,
    generatedAt,
    analyzerVersion: "rules-v0.2",
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
      category: inferredCategory
    },
    policy: {
      title: policy.title,
      status: "已发布",
      issuer: policy.issuer ?? "未知机构",
      publishDate: policy.publish_date ?? "",
      effectiveDate: policy.effective_date ?? policy.publish_date ?? "",
      source: policy.source_name ?? "政策来源",
      category: inferredCategory,
      level: policy.policy_level ?? "政策文件",
      confidence,
      scope: impactScope,
      impactScope,
      sourceUrl: policy.source_url ?? undefined,
      tags: uniqueStrings([
        ...matchedRules.map((rule) => rule.title),
        ...extractKeywords(text).slice(0, 8)
      ])
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
    backgroundCards: buildBackgroundCards(policy, text, evidence, impactScope, matchedRules),
    compareRows: compareInsights.dimensions,
    compareInsights,
    companyInsights,
    analysisCoverage,
    modules: defaultModules(),
    topTabs: defaultTopTabs()
  };
}

function hasUsablePolicyText(value: string | null | undefined): boolean {
  return normalizeText(value ?? "").length >= MIN_POLICY_FULL_TEXT_LENGTH;
}

function buildPolicyAnalysisText(policy: PolicyRecord): string {
  return normalizeText([
    policy.title,
    policy.summary,
    policy.issuer,
    policy.source_name,
    policy.category,
    policy.policy_level,
    policy.full_text
  ].filter(Boolean).join("\n"));
}

function matchIndustryRules(text: string): MatchedIndustryRule[] {
  const normalized = normalizeText(text);
  const lowerText = normalized.toLowerCase();
  const matched = INDUSTRY_RULES.map((rule) => {
    const matchedKeywords = rule.keywords.filter((keyword) =>
      lowerText.includes(keyword.toLowerCase())
    );
    const occurrenceScore = matchedKeywords.reduce(
      (sum, keyword) => sum + Math.min(4, countKeywordOccurrences(normalized, keyword)),
      0
    );

    return {
      ...rule,
      matchedKeywords,
      matchScore: matchedKeywords.length * 12 + occurrenceScore * 3
    };
  })
    .filter((rule) => rule.matchedKeywords.length > 0)
    .sort((left, right) => right.matchScore - left.matchScore || right.matchedKeywords.length - left.matchedKeywords.length);

  return matched.slice(0, 8);
}

function buildCompanyCandidates(
  rules: MatchedIndustryRule[],
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
        existing.score = existing.confidence;
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
        score: confidence,
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

function estimateCompanyPolicyRelevance(rule: MatchedIndustryRule, ruleIndex: number, templateIndex: number): number {
  const base = rule.relation === "直接相关"
    ? 82
    : rule.relation === "潜在受益"
      ? 76
      : rule.relation === "约束风险"
        ? 72
        : rule.relation === "间接相关"
          ? 70
          : 60;

  return clampScoreValue(base + Math.min(8, Math.floor(rule.matchScore / 12)) - ruleIndex * 3 - templateIndex * 2);
}

function estimateCompanyEvidenceCertainty(rule: MatchedIndustryRule, ruleIndex: number, evidenceCount: number): number {
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

function readRecordString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecordNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function readRecordBoolean(record: Record<string, unknown> | null | undefined, key: string): boolean | null {
  const value = record?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function intersectStrings(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  return uniqueStrings(left).filter((item) => rightSet.has(item.toLowerCase()));
}

function differenceStrings(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  return uniqueStrings(left).filter((item) => !rightSet.has(item.toLowerCase()));
}

function jaccardScore(left: string[], right: string[]): number {
  const leftSet = new Set(left.map((item) => item.toLowerCase()).filter(Boolean));
  const rightSet = new Set(right.map((item) => item.toLowerCase()).filter(Boolean));
  if (leftSet.size === 0 && rightSet.size === 0) return 0;

  let intersection = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) intersection += 1;
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function countKeywordOccurrences(text: string, keyword: string): number {
  if (!keyword) return 0;
  const matches = text.match(new RegExp(escapeRegExp(keyword), "gi"));
  return matches?.length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  actionWords: string[];
  actionLabel: string;
  signal: string;
  importance: number;
}> {
  const normalized = normalizeText(text);
  const rankedSentences = splitPolicySentences(normalized)
    .map((sentence, originalIndex) => ({
      sentence,
      originalIndex,
      score: scoreClauseSentence(sentence, originalIndex)
    }))
    .filter((item) => item.sentence.length >= 18)
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex)
    .slice(0, 8)
    .sort((left, right) => left.originalIndex - right.originalIndex);

  const fallback = rankedSentences.length
    ? rankedSentences
    : [{
        sentence: normalized.slice(0, 180) || "政策原文已入库，等待进一步结构化分析。",
        originalIndex: 0,
        score: 40
      }];

  return fallback.map((item, index) => {
    const sentence = item.sentence;
    const keywords = extractKeywords(sentence);
    const industries = matchIndustryRules(sentence).slice(0, 4).map((rule) => rule.title);
    const actionWords = extractActionWords(sentence);
    const signal = inferActionSignal(actionWords, sentence);

    return {
      id: `clause-${index + 1}`,
      no: inferClauseNo(sentence, index),
      title: inferClauseTitle(sentence, index),
      group: inferClauseGroup(sentence, industries, signal),
      excerpt: sentence.slice(0, 220),
      fullText: sentence,
      confidence: Math.max(58, Math.min(94, 64 + Math.min(item.score, 30) + Math.max(0, 4 - index) * 2)),
      keywords,
      industries,
      actionWords,
      actionLabel: inferActionLabel(actionWords, sentence),
      signal,
      importance: item.score
    };
  });
}

function buildActions(rules: MatchedIndustryRule[], clauses: ReturnType<typeof extractPolicyClauses>) {
  const actionClauses = clauses
    .filter((clause) => clause.actionWords.length > 0 || clause.keywords.length > 0)
    .sort((left, right) => right.importance - left.importance)
    .slice(0, 5);

  const actions = actionClauses.map((clause, index) => ({
    id: `action-${index + 1}`,
    title: buildPolicyActionTitle(clause),
    body: clause.excerpt,
    signal: clause.signal,
    confidence: Math.max(58, Math.min(92, clause.confidence - index * 2)),
    clauseIds: [clause.id],
    sortOrder: index
  }));

  if (actions.length > 0) return actions;

  return rules.slice(0, 4).map((rule, index) => ({
    id: `action-${index + 1}`,
    title: `${rule.title}影响识别`,
    body: rule.description,
    signal: rule.relation === "约束风险" ? "约束" : "待验证",
    confidence: Math.max(54, 74 - index * 4),
    clauseIds: [],
    sortOrder: index
  }));
}

function buildChainNodes(
  rules: MatchedIndustryRule[],
  clauses: ExtractedPolicyClause[],
  companyIdsByNodeId: Record<string, string[]>
) {
  if (rules.length === 0) {
    return [{
      id: "implementation",
      title: "政策执行与公共服务",
      subtitle: "执行机制、公共治理、服务供给",
      section: "support" as const,
      relation: "待验证",
      evidenceLevel: "待验证",
      confidence: 52,
      description: "当前文本未命中特定产业词，系统仅保留政策执行层面的占位节点；不据此生成公司候选。",
      clauseIds: clauses.slice(0, 3).map((clause) => clause.id),
      companyIds: [] as string[],
      iconKey: "implementation",
      matchedKeywords: [] as string[],
      evidenceIds: [] as string[]
    }];
  }

  return rules.map((rule, index) => {
    const relatedClauses = findRelatedClausesForRule(rule, clauses);
    const clauseIds = (relatedClauses.length ? relatedClauses : clauses.slice(0, 2)).slice(0, 4).map((clause) => clause.id);
    const confidence = clampScoreValue(
      62 + Math.min(22, rule.matchScore) + Math.min(8, relatedClauses.length * 2) - index * 3
    );

    return {
      id: rule.id,
      title: rule.title,
      subtitle: rule.subtitle,
      section: rule.section,
      relation: rule.relation,
      evidenceLevel: rule.evidenceLevel,
      confidence,
      description: buildNodeDescription(rule, relatedClauses),
      clauseIds,
      companyIds: companyIdsByNodeId[rule.id] ?? [],
      iconKey: rule.id,
      matchedKeywords: rule.matchedKeywords,
      evidenceIds: clauseIds.map((clauseId) => clauseId.replace("clause-", "evidence-"))
    };
  });
}

function buildChainEdges(chainNodes: ReturnType<typeof buildChainNodes>) {
  if (chainNodes.length <= 1) return [];

  const ordered = [...chainNodes].sort((left, right) =>
    getSectionRank(left.section) - getSectionRank(right.section)
  );
  const edges: Array<{ from: string; to: string; type: string; confidence: number }> = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index];
    const to = ordered[index + 1];
    edges.push({
      from: from.id,
      to: to.id,
      type: to.relation === "约束风险" || from.relation === "约束风险" ? "risk" : index === 0 ? "strong" : "medium",
      confidence: clampScoreValue(((from.confidence ?? 60) + (to.confidence ?? 60)) / 2 - index * 2)
    });
  }

  return edges.slice(0, 8);
}

function getSectionRank(section: IndustryRule["section"]): number {
  const ranks: Record<IndustryRule["section"], number> = {
    upstream: 1,
    midstream: 2,
    downstream: 3,
    support: 4
  };
  return ranks[section];
}

function getClauseNodeIds(clause: ExtractedPolicyClause, rules: MatchedIndustryRule[]): string[] {
  return rules
    .filter((rule) => clause.industries.includes(rule.title)
      || rule.matchedKeywords.some((keyword) => clause.fullText.includes(keyword)))
    .slice(0, 4)
    .map((rule) => rule.id);
}

function buildNodeDescription(rule: MatchedIndustryRule, clauses: ExtractedPolicyClause[]): string {
  const keywordText = rule.matchedKeywords.slice(0, 5).join("、") || "相关关键词";
  const actionText = uniqueStrings(clauses.flatMap((clause) => clause.actionWords)).slice(0, 4).join("、") || "政策动作";
  return `${rule.description} 命中关键词：${keywordText}；关联动作：${actionText}。`;
}

function splitPolicySentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[。；;！!？?])\s*|\n+/)
    .map((item) => item.replace(/^[（(]?[一二三四五六七八九十\d]+[）).、\s-]*/, "").trim())
    .filter(Boolean);
}

function scoreClauseSentence(sentence: string, originalIndex: number): number {
  const actionScore = extractActionWords(sentence).length * 8;
  const keywordScore = extractKeywords(sentence).length * 6;
  const industryScore = matchIndustryRules(sentence).length * 8;
  const numberScore = /[0-9０-９]+%?|第[一二三四五六七八九十]+条|专栏|工程|行动/.test(sentence) ? 4 : 0;
  const lengthScore = sentence.length >= 35 && sentence.length <= 220 ? 5 : 0;
  const positionScore = Math.max(0, 6 - originalIndex);
  return actionScore + keywordScore + industryScore + numberScore + lengthScore + positionScore;
}

function extractActionWords(text: string): string[] {
  return ACTION_KEYWORDS.filter((keyword) => text.includes(keyword)).slice(0, 6);
}

function inferActionSignal(actionWords: string[], sentence: string): string {
  if (CONSTRAINT_ACTION_KEYWORDS.some((keyword) => actionWords.includes(keyword) || sentence.includes(keyword))) return "约束";
  if (/风险|处罚|问责|负面清单|红线/.test(sentence)) return "风险";
  if (SUPPORT_ACTION_KEYWORDS.some((keyword) => actionWords.includes(keyword))) return "利好";
  if (IMPLEMENTATION_ACTION_KEYWORDS.some((keyword) => actionWords.includes(keyword))) return "中性";
  return "待验证";
}

function inferActionLabel(actionWords: string[], sentence: string): string {
  if (CONSTRAINT_ACTION_KEYWORDS.some((keyword) => actionWords.includes(keyword) || sentence.includes(keyword))) return "合规约束";
  if (SUPPORT_ACTION_KEYWORDS.some((keyword) => actionWords.includes(keyword))) return "支持方向";
  if (IMPLEMENTATION_ACTION_KEYWORDS.some((keyword) => actionWords.includes(keyword))) return "执行要求";
  return "相关要求";
}

function inferClauseNo(sentence: string, index: number): string {
  const match = sentence.match(/第[一二三四五六七八九十百\d]+条|[一二三四五六七八九十]+、|\d+[.)、]/);
  return match?.[0]?.replace(/[、.)]$/, "") ?? `片段${index + 1}`;
}

function inferClauseGroup(sentence: string, industries: string[], signal: string): string {
  if (signal === "约束" || signal === "风险") return "risk";
  if (industries.length > 0 || extractKeywords(sentence).some((keyword) => ["产业", "产业链", "企业", "制造", "数据", "人工智能"].includes(keyword))) return "industry";
  return "core";
}

function buildPolicyActionTitle(clause: ExtractedPolicyClause): string {
  const keyword = clause.keywords[0] ?? clause.industries[0] ?? "政策";
  return `${keyword}${clause.actionLabel}`;
}

function inferImpactScope(policy: PolicyRecord): string {
  const text = `${policy.title} ${policy.issuer ?? ""} ${policy.policy_level ?? ""} ${policy.source_name ?? ""}`;
  const provinceMatch = text.match(/(北京市|天津市|上海市|重庆市|河北省|山西省|辽宁省|吉林省|黑龙江省|江苏省|浙江省|安徽省|福建省|江西省|山东省|河南省|湖北省|湖南省|广东省|海南省|四川省|贵州省|云南省|陕西省|甘肃省|青海省|台湾省|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|香港特别行政区|澳门特别行政区)/);
  if (provinceMatch) return provinceMatch[1];
  if (/国务院|中共中央|全国|国家|中国政府网|国家发展改革委|国家数据局|工业和信息化部|部委/.test(text)) return "全国";
  return "以政策发布机关管辖范围为准";
}

function buildCompareInsights(
  policy: PolicyRecord,
  comparablePolicies: ComparablePolicyFetchResult,
  matchedRules: MatchedIndustryRule[],
  clauses: ExtractedPolicyClause[],
  actions: ReturnType<typeof buildActions>,
  chainNodes: ReturnType<typeof buildChainNodes>,
  evidence: Array<{ id: string }>
) {
  const currentFingerprint = buildPolicyFingerprint(policy, matchedRules, clauses, actions);

  if (comparablePolicies.status === "query_error") {
    const message = comparablePolicies.message ?? "查询已发布政策失败，未生成可比基准。";
    return {
      status: "query_error",
      comparableCount: 0,
      similarPolicies: [] as ReturnType<typeof summarizeComparablePolicy>[],
      contrastPolicies: [] as ReturnType<typeof summarizeComparablePolicy>[],
      differentPolicies: [] as ReturnType<typeof summarizeComparablePolicy>[],
      dimensions: buildEmptyCompareRows(policy, message),
      similarityPoints: [message],
      differencePoints: ["差异基准未生成；当前仅展示本政策条款、产业节点和证据链。"],
      method: "从 policies 表检索 status=published 的其他政策，使用关键词重叠、产业标签重叠、分类和发布机关计算相似度。",
      emptyReason: message
    };
  }

  const scoredPolicies = comparablePolicies.policies
    .map((item) => scoreComparablePolicy(item, currentFingerprint))
    .filter((item) => item.textLength > 0)
    .sort((left, right) => right.score - left.score);

  if (scoredPolicies.length === 0) {
    const message = "当前库内没有其他已发布政策可作为相似基准或差异基准。";
    return {
      status: "empty",
      comparableCount: 0,
      similarPolicies: [] as ReturnType<typeof summarizeComparablePolicy>[],
      contrastPolicies: [] as ReturnType<typeof summarizeComparablePolicy>[],
      differentPolicies: [] as ReturnType<typeof summarizeComparablePolicy>[],
      dimensions: buildEmptyCompareRows(policy, message),
      similarityPoints: [message],
      differencePoints: ["无可比政策时不生成相似/差异结论，避免用固定模板冒充真实对比。"],
      method: "从 policies 表检索 status=published 的其他政策，使用关键词重叠、产业标签重叠、分类和发布机关计算相似度。",
      emptyReason: message
    };
  }

  const similarScoredPolicies = scoredPolicies
    .filter((item) => item.score >= 18)
    .slice(0, 5);
  const similarPolicies = similarScoredPolicies
    .map(summarizeComparablePolicy);
  const similarPolicyIds = new Set(similarScoredPolicies.map((item) => item.policy.id));
  const contrastPolicies = scoredPolicies
    .filter((item) => !similarPolicyIds.has(item.policy.id))
    .slice()
    .sort((left, right) => left.score - right.score)
    .slice(0, 5)
    .map(summarizeComparablePolicy);
  const status = similarPolicies.length > 0 ? "matched" : "low_overlap";
  const similarityPoints = buildSimilarityPoints(similarPolicies, scoredPolicies.length);
  const differencePoints = buildDifferencePoints(contrastPolicies, currentFingerprint);

  return {
    status,
    comparableCount: scoredPolicies.length,
    similarPolicies,
    contrastPolicies,
    differentPolicies: contrastPolicies,
    dimensions: buildCompareRows({
      policy,
      currentFingerprint,
      similarPolicies,
      contrastPolicies,
      matchedRules,
      clauses,
      actions,
      chainNodes,
      evidence
    }),
    similarityPoints,
    differencePoints,
    method: "从 policies 表检索 status=published 的其他政策，使用关键词重叠、产业标签重叠、分类和发布机关计算相似度；结果仅用于政策文本基准对比。"
  };
}

function buildPolicyFingerprint(
  policy: PolicyRecord,
  rules: MatchedIndustryRule[],
  clauses: ExtractedPolicyClause[],
  actions: ReturnType<typeof buildActions>
): PolicyFingerprint {
  const text = buildPolicyAnalysisText(policy);
  const keywords = uniqueStrings([
    ...extractKeywords(text),
    ...rules.flatMap((rule) => rule.matchedKeywords),
    ...(policy.category ? [policy.category] : [])
  ]).slice(0, 20);

  return {
    keywords,
    ruleIds: rules.map((rule) => rule.id),
    ruleTitles: rules.map((rule) => rule.title),
    category: policy.category ?? inferCategory(text),
    issuer: policy.issuer ?? "",
    actionLabels: uniqueStrings([
      ...actions.map((action) => action.title),
      ...clauses.flatMap((clause) => clause.actionWords),
      ...extractActionWords(text)
    ]).slice(0, 16)
  };
}

function scoreComparablePolicy(policy: PolicyRecord, current: PolicyFingerprint) {
  const text = buildPolicyAnalysisText(policy);
  const rules = matchIndustryRules(text);
  const clauses = extractPolicyClauses(normalizeText(policy.full_text ?? policy.summary ?? policy.title));
  const actions = buildActions(rules, clauses);
  const fingerprint = buildPolicyFingerprint(policy, rules, clauses, actions);
  const keywordScore = jaccardScore(current.keywords, fingerprint.keywords);
  const ruleScore = jaccardScore(current.ruleIds, fingerprint.ruleIds);
  const actionScore = jaccardScore(current.actionLabels, fingerprint.actionLabels);
  const categoryScore = current.category && fingerprint.category && current.category === fingerprint.category ? 1 : 0;
  const issuerScore = current.issuer && fingerprint.issuer && current.issuer === fingerprint.issuer ? 1 : 0;
  const score = clampScoreValue(keywordScore * 45 + ruleScore * 35 + actionScore * 10 + categoryScore * 6 + issuerScore * 4);

  return {
    policy,
    fingerprint,
    score,
    textLength: normalizeText(text).length,
    commonKeywords: intersectStrings(current.keywords, fingerprint.keywords).slice(0, 8),
    commonRules: intersectStrings(current.ruleTitles, fingerprint.ruleTitles).slice(0, 6),
    distinctKeywords: differenceStrings(fingerprint.keywords, current.keywords).slice(0, 8),
    distinctRules: differenceStrings(fingerprint.ruleTitles, current.ruleTitles).slice(0, 6)
  };
}

function summarizeComparablePolicy(item: ReturnType<typeof scoreComparablePolicy>) {
  return {
    id: item.policy.external_id ?? item.policy.id,
    policyId: item.policy.id,
    title: item.policy.title,
    issuer: item.policy.issuer ?? "未知机构",
    publishDate: item.policy.publish_date ?? "",
    category: item.fingerprint.category,
    score: item.score,
    matchedKeywords: item.commonKeywords,
    matchedIndustries: item.commonRules,
    distinctKeywords: item.distinctKeywords,
    distinctIndustries: item.distinctRules,
    basis: item.commonKeywords.length > 0 || item.commonRules.length > 0
      ? `共同命中：${[...item.commonRules, ...item.commonKeywords].slice(0, 6).join("、")}`
      : "关键词与产业标签重叠较低，仅作为差异基准。"
  };
}

function buildCompareRows({
  policy,
  currentFingerprint,
  similarPolicies,
  contrastPolicies,
  matchedRules,
  clauses,
  actions,
  chainNodes,
  evidence
}: {
  policy: PolicyRecord;
  currentFingerprint: PolicyFingerprint;
  similarPolicies: ReturnType<typeof summarizeComparablePolicy>[];
  contrastPolicies: ReturnType<typeof summarizeComparablePolicy>[];
  matchedRules: MatchedIndustryRule[];
  clauses: ExtractedPolicyClause[];
  actions: ReturnType<typeof buildActions>;
  chainNodes: ReturnType<typeof buildChainNodes>;
  evidence: Array<{ id: string }>;
}): string[][] {
  const similarBase = similarPolicies.length
    ? similarPolicies.slice(0, 2).map((item) => `《${item.title}》（${item.score}）`).join("、")
    : "无高重叠相似政策";
  const contrastBase = contrastPolicies.length
    ? contrastPolicies.slice(0, 2).map((item) => `《${item.title}》（${item.score}）`).join("、")
    : "无差异政策基准";
  const currentIndustry = chainNodes.map((node) => node.title).slice(0, 6).join("、") || "尚未形成产业节点";
  const similarIndustry = uniqueStrings(similarPolicies.flatMap((item) => item.matchedIndustries)).slice(0, 6).join("、") || "未形成稳定重叠";
  const contrastIndustry = uniqueStrings(contrastPolicies.flatMap((item) => item.distinctIndustries)).slice(0, 6).join("、") || "主要差异来自关键词和政策动作";

  return [
    ["可比基准", policy.title, similarBase, contrastBase],
    ["主题关键词", currentFingerprint.keywords.slice(0, 8).join("、") || "未命中关键词", uniqueStrings(similarPolicies.flatMap((item) => item.matchedKeywords)).slice(0, 8).join("、") || "无明显重叠", uniqueStrings(contrastPolicies.flatMap((item) => item.distinctKeywords)).slice(0, 8).join("、") || "差异关键词不足"],
    ["产业节点", currentIndustry, similarIndustry, contrastIndustry],
    ["政策动作", actions.map((action) => action.title).slice(0, 5).join("、") || "未识别动作", "按动作词与条款标题做重叠判断", "低重叠政策作为差异基准，不推导投资结论"],
    ["证据基础", `${clauses.length} 条条款 / ${evidence.length} 条证据 / ${matchedRules.length} 个命中产业规则`, "仅使用已入库已发布政策文本", "未接入外部市场、财务或订单数据"]
  ];
}

function buildEmptyCompareRows(policy: PolicyRecord, message: string): string[][] {
  return [
    ["可比基准状态", policy.title, message, message],
    ["相似政策", "当前政策已完成条款和产业识别", "[]", "无可用相似基准"],
    ["差异政策", "当前政策已完成动作和证据识别", "无可用差异基准", "[]"]
  ];
}

function buildSimilarityPoints(
  similarPolicies: ReturnType<typeof summarizeComparablePolicy>[],
  comparableCount: number
): string[] {
  if (similarPolicies.length === 0) {
    return [`已检索 ${comparableCount} 篇已发布政策，但关键词和产业标签重叠不足，暂不输出相似政策结论。`];
  }

  return similarPolicies.slice(0, 3).map((item) =>
    `与《${item.title}》相似度 ${item.score}/100，${item.basis}`
  );
}

function buildDifferencePoints(
  contrastPolicies: ReturnType<typeof summarizeComparablePolicy>[],
  currentFingerprint: PolicyFingerprint
): string[] {
  if (contrastPolicies.length === 0) {
    return ["无可比政策时不生成差异基准。"];
  }

  const currentKeywords = currentFingerprint.keywords.slice(0, 6).join("、") || "当前主题";
  return contrastPolicies.slice(0, 3).map((item) => {
    const difference = item.distinctKeywords.slice(0, 5).join("、") || item.distinctIndustries.slice(0, 5).join("、") || "主题侧重不同";
    return `相较《${item.title}》，当前政策更集中于 ${currentKeywords}；该差异基准侧重 ${difference}。`;
  });
}

function buildCompanyInsights(
  companies: CompanyCandidate[],
  rules: MatchedIndustryRule[],
  clauses: ExtractedPolicyClause[]
) {
  if (companies.length === 0) {
    const hasIndustryMatch = rules.length > 0;
    return {
      status: "empty",
      companyCount: 0,
      note: hasIndustryMatch
        ? "已命中产业节点，但静态代表性公司候选库没有可解释匹配，返回空数组；系统不会用样例公司补齐。"
        : "未命中可解释产业节点，返回空数组；系统不会用样例公司补齐。",
      candidateSource: CANDIDATE_MAPPING_NOTE,
      matchedNodeIds: rules.map((rule) => rule.id),
      matchedKeywords: uniqueStrings(rules.flatMap((rule) => rule.matchedKeywords)),
      clauseCount: clauses.length
    };
  }

  return {
    status: "matched",
    companyCount: companies.length,
    note: CANDIDATE_MAPPING_NOTE,
    candidateSource: "静态代表性候选库 + 政策文本关键词/产业节点/条款证据匹配",
    matchedNodeIds: uniqueStrings(companies.flatMap((company) => company.nodeIds)),
    matchedKeywords: uniqueStrings(rules.flatMap((rule) => rule.matchedKeywords)),
    clauseCount: clauses.length
  };
}

function buildAnalysisCoverage({
  policy,
  matchedRules,
  clauses,
  actions,
  companies,
  evidence,
  compareInsights,
  comparablePolicies
}: {
  policy: PolicyRecord;
  matchedRules: MatchedIndustryRule[];
  clauses: ExtractedPolicyClause[];
  actions: ReturnType<typeof buildActions>;
  companies: CompanyCandidate[];
  evidence: Array<{ id: string }>;
  compareInsights: ReturnType<typeof buildCompareInsights>;
  comparablePolicies: ComparablePolicyFetchResult;
}) {
  const matchedKeywords = uniqueStrings(matchedRules.flatMap((rule) => rule.matchedKeywords));

  return {
    status: matchedRules.length > 0 ? "matched" : "limited",
    textLength: normalizeText(policy.full_text ?? "").length,
    policyFieldsUsed: ["title", "summary", "issuer", "source_name", "category", "policy_level", "full_text"],
    matchedKeywordCount: matchedKeywords.length,
    matchedKeywords,
    industryRuleCount: matchedRules.length,
    fallbackIndustryNode: matchedRules.length === 0,
    clauseCount: clauses.length,
    actionCount: actions.length,
    companyCandidateCount: companies.length,
    companyCandidateStatus: companies.length > 0 ? "matched" : "empty",
    evidenceCount: evidence.length,
    compareStatus: compareInsights.status,
    comparablePolicyCount: compareInsights.comparableCount,
    comparableQueryStatus: comparablePolicies.status,
    limitations: [
      "公司候选仅来自静态代表性库，不做持续跟踪、受益测算或投资建议。",
      "对比分析仅使用已入库且 status=published 的政策文本，不接入外部市场或财务数据。",
      "规则分析以关键词、条款动作和产业标签为主，低命中文本需要人工复核。"
    ]
  };
}

function buildBackgroundCards(
  policy: PolicyRecord,
  text: string,
  evidence: Array<{ id: string }>,
  impactScope: string,
  rules: MatchedIndustryRule[]
) {
  const matchedDirections = rules.map((rule) => rule.title).join("、") || "尚未命中明确产业方向";
  const matchedKeywords = uniqueStrings(rules.flatMap((rule) => rule.matchedKeywords)).slice(0, 10).join("、") || "无明确产业关键词";

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
      body: `本政策影响范围判断为：${impactScope}。产业方向另行展示为：${matchedDirections}。命中关键词：${matchedKeywords}。`,
      evidenceIds: evidence.slice(0, 3).map((item) => item.id)
    },
    {
      id: "method",
      title: "分析方法",
      body: "当前为规则驱动的基础自动分析：用标题、摘要、发布机关、来源、分类和政策正文做关键词、条款、动作、产业节点、公司候选与可比政策计算；公司候选仅来自静态代表性库，不做持续跟踪或投资建议。",
      evidenceIds: []
    }
  ];
}

function estimateConfidence(policy: PolicyRecord, clauses: ExtractedPolicyClause[], rules: MatchedIndustryRule[]): number {
  let score = 62;
  if (policy.source_url) score += 6;
  if ((policy.full_text?.length ?? 0) > 500) score += 12;
  if (clauses.length >= 3) score += 8;
  if (rules.length >= 2) score += 8;
  if (rules.some((rule) => rule.evidenceLevel === "强证据")) score += 4;
  if (clauses.some((clause) => clause.actionWords.length > 0)) score += 4;
  if (rules.length === 0) score -= 12;
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
  const actionLabel = inferActionLabel(extractActionWords(sentence), sentence);
  return keyword ? `${keyword}${actionLabel}` : `核心片段${index + 1}`;
}

function extractKeywords(text: string): string[] {
  const keywords = [
    "人工智能",
    "大模型",
    "算力",
    "算法",
    "数据",
    "数据要素",
    "公共数据",
    "能源",
    "电力",
    "安全",
    "监管",
    "合规",
    "标准",
    "平台",
    "基础设施",
    "产业",
    "产业链",
    "企业",
    "创新",
    "绿色",
    "低碳",
    "制造",
    "装备",
    "半导体",
    "芯片",
    "集成电路",
    "机器人",
    "自动化",
    "医疗",
    "医药",
    "金融",
    "物流",
    "供应链",
    "农业",
    "教育",
    "人才",
    "数字化",
    "智能化",
    "中小企业",
    "服务"
  ];
  return keywords.filter((keyword) => text.includes(keyword)).slice(0, 12);
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
    { id: "background", label: "背景与边界" },
    { id: "compare", label: "对比分析" },
    { id: "companies", label: "公司影响分析" },
    { id: "evidence", label: "证据链总览" }
  ];
}

function defaultTopTabs() {
  return [
    { id: "brief", label: "政策速读" },
    { id: "clauses", label: "政策条款" },
    { id: "background", label: "背景与边界" },
    { id: "compare", label: "对比分析" }
  ];
}
