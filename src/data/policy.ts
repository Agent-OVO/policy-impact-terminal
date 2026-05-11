import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Building2,
  Database,
  Factory,
  FileText,
  Landmark,
  Layers3,
  Network,
  ShieldCheck,
  Sparkles,
  Workflow
} from "lucide-react";

export type ModuleId =
  | "brief"
  | "industry"
  | "clauses"
  | "background"
  | "compare"
  | "companies"
  | "evidence";

export type Signal = "利好" | "约束" | "风险" | "待验证";
export type EvidenceLevel = "强证据" | "间接证据" | "待验证";
export type RelationType = "直接相关" | "间接相关" | "潜在受益" | "约束风险" | "待验证";

export interface PolicyMeta {
  title: string;
  status: string;
  issuer: string;
  publishDate: string;
  effectiveDate: string;
  source: string;
  category: string;
  level: string;
  confidence: number;
  sourceUrl?: string;
  source_url?: string;
  scope?: string;
  impactScope?: string;
  jurisdiction?: string;
  tags?: string[];
}

export interface PolicyAction {
  id: string;
  title: string;
  body: string;
  signal: Signal;
  confidence: number;
}

export interface ClauseGroup {
  id: string;
  title: string;
  count: number;
  tone: "blue" | "purple" | "green" | "orange";
}

export interface Clause {
  id: string;
  no: string;
  title: string;
  group: string;
  excerpt: string;
  confidence: number;
  keywords: string[];
  industries: string[];
}

export interface ChainNode {
  id: string;
  title: string;
  subtitle: string;
  section: "upstream" | "midstream" | "downstream" | "support";
  relation: RelationType;
  evidence: EvidenceLevel;
  confidence: number;
  description: string;
  clauses: string[];
  companies: string[];
  icon: LucideIcon;
}

export interface ChainEdge {
  from: string;
  to: string;
  type: "strong" | "medium" | "weak" | "risk";
}

export interface Company {
  id: string;
  name: string;
  ticker: string;
  platform: string;
  status: string;
  section: ChainNode["section"];
  relation: RelationType;
  evidence: EvidenceLevel;
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
}

export interface Evidence {
  id: string;
  title: string;
  source: string;
  type: string;
  date: string;
  excerpt: string;
  confidence: number;
}

export const policy: PolicyMeta = {
  title: "关于推动数据要素市场化配置 加快培育数据产业的意见",
  status: "新政",
  issuer: "国家发展改革委等17部门",
  publishDate: "2024-05-28",
  effectiveDate: "2024-05-29",
  source: "国家数据局官网",
  category: "指导意见",
  level: "国务院部门文件",
  confidence: 78,
  sourceUrl: "https://www.nda.gov.cn/sjj/zwgk/zcfb/list/index_pc_1.html",
  scope: "全国"
};

export const actions: PolicyAction[] = [
  {
    id: "a1",
    title: "健全数据要素市场制度",
    body: "完善产权、流通交易、收益分配和安全治理等基础制度体系。",
    signal: "利好",
    confidence: 92
  },
  {
    id: "a2",
    title: "促进数据高效流通使用",
    body: "建设流通基础设施，推动公共数据、企业数据、个人数据合规流通。",
    signal: "利好",
    confidence: 89
  },
  {
    id: "a3",
    title: "培育壮大数据产业",
    body: "支持数据企业规模化发展，培育数据服务、数据应用等产业生态。",
    signal: "利好",
    confidence: 86
  },
  {
    id: "a4",
    title: "强化数据安全与合规约束",
    body: "加强数据安全治理、个人信息保护和跨境数据流动管理。",
    signal: "约束",
    confidence: 82
  }
];

export const clauseGroups: ClauseGroup[] = [
  { id: "general", title: "总体要求", count: 3, tone: "blue" },
  { id: "tasks", title: "重点任务", count: 8, tone: "purple" },
  { id: "application", title: "推进数据要素应用", count: 4, tone: "green" },
  { id: "support", title: "保障措施", count: 4, tone: "orange" },
  { id: "monitor", title: "监督机制", count: 2, tone: "blue" }
];

export const clauses: Clause[] = [
  {
    id: "c1",
    no: "第1条",
    title: "总体要求",
    group: "general",
    excerpt: "到2029年，数据要素市场化配置机制更加健全，数据要素价值释放取得明显成效。",
    confidence: 92,
    keywords: ["发展目标", "总体原则"],
    industries: ["数据服务", "数据交易", "产业生态"]
  },
  {
    id: "c2",
    no: "第2条",
    title: "总体原则",
    group: "general",
    excerpt: "坚持市场主导、政府引导，坚持创新驱动、应用牵引，强化安全合规底线。",
    confidence: 89,
    keywords: ["原则框架", "治理规则"],
    industries: ["数据治理", "隐私计算"]
  },
  {
    id: "c3",
    no: "第3条",
    title: "深化数据资源开发利用",
    group: "tasks",
    excerpt: "推动公共数据、企业数据、个人数据融合应用，提升数据资源供给质量。",
    confidence: 91,
    keywords: ["数据供给", "资源开发"],
    industries: ["数据采集", "数据标注", "数据应用"]
  },
  {
    id: "c4",
    no: "第4条",
    title: "培育数据产业生态",
    group: "tasks",
    excerpt: "支持数据企业做强做优，培育数据服务、数据流通、数据应用等产业生态。",
    confidence: 88,
    keywords: ["产业培育", "生态建设"],
    industries: ["数据服务", "数据交易", "数据产品"]
  },
  {
    id: "c5",
    no: "第5条",
    title: "构建数据流通交易体系",
    group: "tasks",
    excerpt: "建设数据流通基础设施，培育多元化数据流通交易主体。",
    confidence: 90,
    keywords: ["流通交易", "市场组织"],
    industries: ["数据交易所", "可信流通"]
  },
  {
    id: "c6",
    no: "第6条",
    title: "强化数据安全保护",
    group: "support",
    excerpt: "健全数据安全保护制度，落实数据安全分类分级、风险评估和应急处置要求。",
    confidence: 86,
    keywords: ["安全治理", "风险防护"],
    industries: ["数据安全", "隐私计算", "合规服务"]
  }
];

export const chainNodes: ChainNode[] = [
  {
    id: "collection",
    title: "数据采集",
    subtitle: "源数据、公共数据接口",
    section: "upstream",
    relation: "潜在受益",
    evidence: "强证据",
    confidence: 82,
    description: "政策强调扩大高质量数据供给，数据采集和公共数据接口服务是产业链前端入口。",
    clauses: ["c3"],
    companies: ["ailyun"],
    icon: Database
  },
  {
    id: "storage",
    title: "数据存储与计算",
    subtitle: "云数据库、湖仓、算力",
    section: "upstream",
    relation: "直接相关",
    evidence: "强证据",
    confidence: 86,
    description: "数据资源开发利用和流通交易需要稳定的存储、计算和数据治理底座。",
    clauses: ["c3", "c5"],
    companies: ["sh-data", "aliyun"],
    icon: Layers3
  },
  {
    id: "processing",
    title: "数据标注与加工",
    subtitle: "清洗、标注、质量评估",
    section: "upstream",
    relation: "间接相关",
    evidence: "间接证据",
    confidence: 73,
    description: "高质量数据供给需要标注、清洗、治理和质量评估，受益路径偏中长期。",
    clauses: ["c3"],
    companies: ["daily"],
    icon: Sparkles
  },
  {
    id: "security",
    title: "数据安全与隐私保护",
    subtitle: "分类分级、隐私计算",
    section: "upstream",
    relation: "约束风险",
    evidence: "强证据",
    confidence: 89,
    description: "数据安全和个人信息保护是本政策的底线约束，也会拉动安全合规服务需求。",
    clauses: ["c2", "c6"],
    companies: ["qi-an-xin"],
    icon: ShieldCheck
  },
  {
    id: "exchange",
    title: "数据流通与交易平台",
    subtitle: "数据交易、登记结算",
    section: "midstream",
    relation: "直接相关",
    evidence: "强证据",
    confidence: 88,
    description: "政策直接提出建设数据流通交易体系，是当前政策影响最集中的产业节点。",
    clauses: ["c4", "c5"],
    companies: ["sh-data", "zj-culture"],
    icon: Workflow
  },
  {
    id: "development",
    title: "数据开发利用平台",
    subtitle: "数据治理、开发工具",
    section: "midstream",
    relation: "直接相关",
    evidence: "强证据",
    confidence: 80,
    description: "围绕数据开发、治理、建模、应用开发的平台会承接政策推动的数据价值释放。",
    clauses: ["c3", "c4"],
    companies: ["digiwin", "daily"],
    icon: Network
  },
  {
    id: "registration",
    title: "数据确权与登记",
    subtitle: "产权登记、凭证服务",
    section: "midstream",
    relation: "间接相关",
    evidence: "间接证据",
    confidence: 70,
    description: "数据产权制度和登记机制仍在建设期，相关服务具备制度建设预期。",
    clauses: ["c2", "c5"],
    companies: ["sh-data"],
    icon: BadgeCheck
  },
  {
    id: "fintech",
    title: "金融科技",
    subtitle: "风控、征信、数据产品",
    section: "downstream",
    relation: "直接相关",
    evidence: "间接证据",
    confidence: 76,
    description: "金融是数据要素应用高价值场景之一，重点看数据合规流通和产品化能力。",
    clauses: ["c3", "c4"],
    companies: ["sh-data"],
    icon: Landmark
  },
  {
    id: "manufacturing",
    title: "智能制造",
    subtitle: "产业数据、工厂模型",
    section: "downstream",
    relation: "直接相关",
    evidence: "强证据",
    confidence: 84,
    description: "制造业数字化转型和数据资产开发是数据要素应用的重要出口。",
    clauses: ["c3"],
    companies: ["digiwin", "daily"],
    icon: Factory
  },
  {
    id: "city",
    title: "智慧城市",
    subtitle: "公共数据、城市治理",
    section: "downstream",
    relation: "直接相关",
    evidence: "强证据",
    confidence: 81,
    description: "公共数据开放和城市治理场景带来数据服务、数据产品和平台建设需求。",
    clauses: ["c3"],
    companies: ["sh-data", "digital-china"],
    icon: Building2
  },
  {
    id: "medical",
    title: "医疗健康",
    subtitle: "健康数据、医保数据",
    section: "downstream",
    relation: "潜在受益",
    evidence: "间接证据",
    confidence: 65,
    description: "医疗健康数据价值高，但合规要求强，政策受益需要结合后续细则判断。",
    clauses: ["c2", "c6"],
    companies: ["daily"],
    icon: FileText
  },
  {
    id: "standard",
    title: "标准规范体系",
    subtitle: "流通规则、接口标准",
    section: "support",
    relation: "直接相关",
    evidence: "强证据",
    confidence: 85,
    description: "统一标准决定数据流通和交易平台的互联互通，是政策落地的基础设施。",
    clauses: ["c2", "c5"],
    companies: ["sh-data"],
    icon: BadgeCheck
  },
  {
    id: "governance",
    title: "数据安全治理",
    subtitle: "合规、评估、审计",
    section: "support",
    relation: "约束风险",
    evidence: "强证据",
    confidence: 91,
    description: "安全治理会成为数据要素市场化配置的硬约束，相关公司同时面临机会和合规要求。",
    clauses: ["c6"],
    companies: ["qi-an-xin"],
    icon: ShieldCheck
  },
  {
    id: "talent",
    title: "人才培养",
    subtitle: "数据人才、复合人才",
    section: "support",
    relation: "间接相关",
    evidence: "待验证",
    confidence: 58,
    description: "人才培养是政策保障项，产业映射较间接，适合作为背景而非主受益环节。",
    clauses: ["c4"],
    companies: [],
    icon: Sparkles
  },
  {
    id: "funding",
    title: "资金与金融支持",
    subtitle: "试点、基金、补贴",
    section: "support",
    relation: "潜在受益",
    evidence: "间接证据",
    confidence: 68,
    description: "金融支持将影响数据产业试点和企业扩张，但具体受益主体需要后续地方政策验证。",
    clauses: ["c4"],
    companies: ["sh-data"],
    icon: Landmark
  }
];

export const chainEdges: ChainEdge[] = [
  { from: "collection", to: "exchange", type: "strong" },
  { from: "storage", to: "exchange", type: "strong" },
  { from: "processing", to: "exchange", type: "medium" },
  { from: "security", to: "exchange", type: "risk" },
  { from: "storage", to: "development", type: "strong" },
  { from: "processing", to: "development", type: "medium" },
  { from: "exchange", to: "fintech", type: "strong" },
  { from: "exchange", to: "manufacturing", type: "strong" },
  { from: "exchange", to: "city", type: "strong" },
  { from: "development", to: "manufacturing", type: "medium" },
  { from: "development", to: "medical", type: "weak" },
  { from: "standard", to: "exchange", type: "strong" },
  { from: "governance", to: "exchange", type: "risk" },
  { from: "funding", to: "development", type: "weak" },
  { from: "governance", to: "medical", type: "risk" }
];

export const companies: Company[] = [
  {
    id: "sh-data",
    name: "上海数据交易所",
    ticker: "600000.SH",
    platform: "数据流通与交易平台",
    status: "国资平台",
    section: "midstream",
    relation: "直接相关",
    evidence: "强证据",
    confidence: 92,
    policyRelevance: 94,
    evidenceCertainty: 91,
    evidenceCount: 8,
    products: ["数据交易", "数据登记", "数据产品"],
    nodeIds: ["exchange"],
    clauseIds: ["c4", "c5"],
    evidenceIds: ["e1", "e2", "e3", "e4"],
    reason: "政策直接支持数据流通交易体系建设，交易所类平台处于政策作用链条的核心位置。",
    uncertainty: "具体收入贡献取决于交易规则、地方试点和数据产品标准化进度。"
  },
  {
    id: "zj-culture",
    name: "浙数文化",
    ticker: "600633.SH",
    platform: "数据开发利用平台",
    status: "上市公司",
    section: "midstream",
    relation: "间接相关",
    evidence: "强证据",
    confidence: 82,
    policyRelevance: 78,
    evidenceCertainty: 78,
    evidenceCount: 6,
    products: ["数据交易服务", "平台运营"],
    nodeIds: ["development", "exchange"],
    clauseIds: ["c4", "c5"],
    evidenceIds: ["e1", "e3", "e4"],
    reason: "公司布局数据交易和数字化服务，可能受益于数据要素市场扩容。",
    uncertainty: "需验证数据业务收入占比和平台实际交易活跃度。"
  },
  {
    id: "daily",
    name: "每日互动",
    ticker: "300766.SZ",
    platform: "数据服务商",
    status: "上市公司",
    section: "downstream",
    relation: "潜在受益",
    evidence: "间接证据",
    confidence: 72,
    policyRelevance: 72,
    evidenceCertainty: 62,
    evidenceCount: 5,
    products: ["数据智能", "城市治理"],
    nodeIds: ["city"],
    clauseIds: ["c3", "c4"],
    evidenceIds: ["e1", "e3"],
    reason: "数据应用和数据产品化方向与政策鼓励的数据产业生态匹配。",
    uncertainty: "应用场景与政策条款相关，但直接政策受益证据仍需补充。"
  },
  {
    id: "digiwin",
    name: "数鼎科技",
    ticker: "未上市",
    platform: "数据资产管理平台",
    status: "未上市",
    section: "midstream",
    relation: "待验证",
    evidence: "待验证",
    confidence: 45,
    policyRelevance: 61,
    evidenceCertainty: 36,
    evidenceCount: 3,
    products: ["数据治理", "资产管理"],
    nodeIds: ["governance"],
    clauseIds: ["c2", "c6"],
    evidenceIds: ["e3"],
    reason: "与数据治理、数据资产管理方向相关，但公开证据不足。",
    uncertainty: "需要进一步核实企业主体、业务规模和政策条款对应关系。"
  },
  {
    id: "qi-an-xin",
    name: "奇安信",
    ticker: "688561.SH",
    platform: "数据安全治理",
    status: "上市公司",
    section: "support",
    relation: "约束风险",
    evidence: "强证据",
    confidence: 76,
    policyRelevance: 69,
    evidenceCertainty: 88,
    evidenceCount: 6,
    products: ["数据安全", "合规评估", "风险监测"],
    nodeIds: ["governance", "security"],
    clauseIds: ["c2", "c6"],
    evidenceIds: ["e2", "e3", "e5"],
    reason: "政策强化数据安全、分类分级和合规要求，安全服务需求具备确定性。",
    uncertainty: "安全投入释放节奏取决于地方执行力度和数据流通场景落地速度。"
  },
  {
    id: "aliyun",
    name: "阿里云",
    ticker: "BABA / 9988.HK",
    platform: "数据底座与云计算",
    status: "上市集团",
    section: "upstream",
    relation: "间接相关",
    evidence: "间接证据",
    confidence: 78,
    policyRelevance: 66,
    evidenceCertainty: 70,
    evidenceCount: 6,
    products: ["云数据库", "湖仓", "AI开发平台"],
    nodeIds: ["storage", "development"],
    clauseIds: ["c3", "c4"],
    evidenceIds: ["e1", "e3"],
    reason: "数据要素产业化需要云、算力和数据开发底座支撑。",
    uncertainty: "政策并不直接指向云厂商，需要结合客户侧数据产品化需求判断。"
  },
  {
    id: "digital-china",
    name: "数字政通",
    ticker: "300075.SZ",
    platform: "城市数据应用",
    status: "上市公司",
    section: "downstream",
    relation: "潜在受益",
    evidence: "间接证据",
    confidence: 69,
    policyRelevance: 58,
    evidenceCertainty: 59,
    evidenceCount: 4,
    products: ["城市治理", "公共数据应用"],
    nodeIds: ["city"],
    clauseIds: ["c3", "c4"],
    evidenceIds: ["e1", "e3"],
    reason: "公共数据开发利用和智慧城市场景与公司业务方向存在交集。",
    uncertainty: "需要验证具体订单是否来自数据要素相关政策落地。"
  }
];

export const evidence: Evidence[] = [
  {
    id: "e1",
    title: "政策原文：关于推动数据要素市场化配置加快培育数据产业的意见",
    source: "国家数据局官网",
    type: "政策原文",
    date: "2024-05-28",
    excerpt: "支持数据企业做强做优，培育数据服务、数据流通、数据应用等产业生态。",
    confidence: 95
  },
  {
    id: "e2",
    title: "国家发展改革委答记者问",
    source: "国家发改委官网",
    type: "权威解读",
    date: "2024-05-28",
    excerpt: "围绕数据资源开发利用、流通交易、收益分配和安全治理提出政策安排。",
    confidence: 90
  },
  {
    id: "e3",
    title: "数据要素白皮书",
    source: "中国信通院",
    type: "机构研究",
    date: "2024-05-30",
    excerpt: "数据流通平台、隐私计算和数据治理是数据要素市场建设的基础支撑。",
    confidence: 82
  },
  {
    id: "e4",
    title: "上海数据交易所年度报告",
    source: "上海数据交易所",
    type: "外部证据",
    date: "2024-07-12",
    excerpt: "围绕数据产品登记、挂牌、交易和合规服务形成平台能力。",
    confidence: 78
  },
  {
    id: "e5",
    title: "数据安全法",
    source: "全国人大",
    type: "法律法规",
    date: "2021-09-01",
    excerpt: "国家建立数据分类分级保护制度，加强重要数据保护。",
    confidence: 88
  }
];

export const backgroundCards = [
  {
    title: "政策出台背景",
    body: "数据作为新型生产要素，已成为驱动经济社会发展的重要引擎，但数据要素市场化配置仍面临规则不清、流通机制不畅、应用场景不足等问题。"
  },
  {
    title: "产业与市场背景",
    body: "2023年我国数据产业规模达2万亿元，年均增长约15%，数据资源市场化改革进入关键阶段。"
  },
  {
    title: "相关政策脉络",
    body: "从数据二十条到数字中国建设，再到本次意见，政策主线由顶层设计走向产业生态和交易机制建设。"
  }
];

export const compareRows = [
  ["目标导向", "构建流通有序、平等竞争、繁荣发展的数据要素市场体系", "推进数字经济高质量发展，数据要素价值进一步释放", "推动大数据产业健康发展，培育新增长点"],
  ["支持方向", "数据流通、场景供给、标准体系、安全建设", "数据资源整合、平台互联互通、融合应用", "数据资源开放共享、应用示范、行业融合"],
  ["约束条款", "数据安全分类分级、合规使用、隐私保护、反垄断与公平竞争", "数据安全保护、个人信息保护、跨境数据流动监管", "数据安全管理、保密审查、知识产权保护"],
  ["适用对象", "政府部门、数据企业、平台企业、行业主体、社会组织", "各级政府、企业、科研机构、行业组织", "各级政府部门、企事业单位、相关机构"],
  ["产业影响", "提升数据要素配置效率，催生数据产品和交易服务", "壮大数字产业规模，推动实体经济数字化专业升级", "促进大数据产业成长，带动相关产业发展"]
];

export const modules: Array<{ id: ModuleId; label: string; badge?: string }> = [
  { id: "brief", label: "政策速读" },
  { id: "industry", label: "产业链影响", badge: "NEW" },
  { id: "clauses", label: "政策条款" },
  { id: "background", label: "政策背景" },
  { id: "compare", label: "对比分析" },
  { id: "companies", label: "公司影响分析" },
  { id: "evidence", label: "证据链总览" }
];

export const topTabs: Array<{ id: ModuleId; label: string }> = [
  { id: "brief", label: "政策总览" },
  { id: "clauses", label: "政策条款" },
  { id: "background", label: "政策背景" },
  { id: "compare", label: "对比分析" }
];
