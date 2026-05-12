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
import type {
  ChainEdge as AppChainEdge,
  ChainNode as AppChainNode,
  Clause as AppClause,
  ClauseGroup as AppClauseGroup,
  Company as AppCompany,
  AnalysisCoverage as AppAnalysisCoverage,
  CompareInsights as AppCompareInsights,
  Evidence as AppEvidence,
  ModuleId as AppModuleId,
  PolicyAction as AppPolicyAction,
  PolicyMeta as AppPolicyMeta,
  Signal as AppSignal
} from "../data/policy";
import type {
  AnalysisJob,
  AnalysisJobRow,
  AnalysisJobStatus,
  ChainEdgeType,
  ClauseGroup,
  ClauseTone,
  CompanyImpact,
  EvidenceItem,
  EvidenceLevel,
  IndustryEdge,
  IndustryNode,
  IndustrySection,
  PolicyAction,
  PolicyBackgroundCard,
  PolicyClause,
  PolicyComparisonRow,
  PolicyMeta,
  PolicyReport,
  PolicySignal,
  PolicySummary,
  PolicySummaryCounts,
  PolicySummaryRow,
  RelationType,
  ReportNavItem,
  ReportStatus
} from "../types";
import { clampPercent, clampScore } from "../utils/confidence";
import { createPolicySummary } from "../utils/reportStats";

type JsonRecord = Record<string, unknown>;

export interface AppPolicyReport {
  id: string;
  summary: PolicySummary;
  brief?: {
    judgement: string;
    summary?: string;
    keyPoints?: string[];
    methodology?: string;
  };
  policy: AppPolicyMeta;
  actions: AppPolicyAction[];
  clauseGroups: AppClauseGroup[];
  clauses: AppClause[];
  chainNodes: AppChainNode[];
  chainEdges: AppChainEdge[];
  companies: AppCompany[];
  evidence: AppEvidence[];
  backgroundCards: Array<{ title: string; body: string }>;
  compareRows: string[][];
  compareInsights?: AppCompareInsights;
  analysisCoverage?: AppAnalysisCoverage;
  modules: Array<{ id: AppModuleId; label: string; badge?: string }>;
  topTabs: Array<{ id: AppModuleId; label: string }>;
  generatedAt?: string;
}

export interface AppPolicyReportContext {
  id?: string;
  title?: string | null;
  issuer?: string | null;
  sourceName?: string | null;
  publishDate?: string | null;
  effectiveDate?: string | null;
  status?: string | null;
  confidence?: number | null;
  category?: string | null;
  policyLevel?: string | null;
  sourceUrl?: string | null;
  summary?: Partial<PolicySummary>;
}

interface PolicyMetaLike {
  title?: string;
  status?: string;
  issuer?: string;
  publishDate?: string;
  publish_date?: string;
  effectiveDate?: string;
  effective_date?: string;
  source?: string;
  sourceName?: string;
  source_name?: string;
  category?: string;
  level?: string;
  policyLevel?: string;
  policy_level?: string;
  confidence?: number;
  sourceUrl?: string;
  source_url?: string;
  jurisdiction?: string;
  tags?: readonly string[];
}

interface PolicyActionLike {
  id?: string;
  title?: string;
  body?: string;
  signal?: string;
  confidence?: number;
  clauses?: readonly string[];
  clauseIds?: readonly string[];
  sortOrder?: number;
  sort_order?: number;
}

interface ClauseGroupLike {
  id?: string;
  title?: string;
  count?: number;
  tone?: string;
}

interface PolicyClauseLike {
  id?: string;
  no?: string;
  clause_no?: string;
  title?: string;
  group?: string;
  clause_group?: string;
  excerpt?: string;
  fullText?: string;
  full_text?: string;
  confidence?: number;
  keywords?: readonly string[];
  industries?: readonly string[];
  sortOrder?: number;
  sort_order?: number;
}

interface IndustryNodeLike {
  id?: string;
  node_key?: string;
  title?: string;
  subtitle?: string;
  section?: string;
  relation?: string;
  evidence?: string;
  evidenceLevel?: string;
  evidence_level?: string;
  confidence?: number;
  description?: string;
  clauses?: readonly string[];
  clauseIds?: readonly string[];
  clause_refs?: readonly string[];
  companies?: readonly string[];
  companyIds?: readonly string[];
  company_refs?: readonly string[];
  evidenceIds?: readonly string[];
  evidence_ids?: readonly string[];
  impactReason?: string;
  impact_reason?: string;
  iconKey?: string;
}

interface IndustryEdgeLike {
  from?: string;
  from_node_id?: string;
  to?: string;
  to_node_id?: string;
  type?: string;
  edge_type?: string;
  confidence?: number;
  reason?: string;
}

interface CompanyImpactLike {
  id?: string;
  company_key?: string;
  name?: string;
  ticker?: string;
  exchange?: string;
  platform?: string;
  status?: string;
  section?: string;
  relation?: string;
  evidence?: string;
  evidenceLevel?: string;
  evidence_level?: string;
  confidence?: number;
  evidenceCount?: number;
  evidence_count?: number;
  products?: readonly string[];
  reason?: string;
  uncertainty?: string;
  nodeIds?: readonly string[];
  node_ids?: readonly string[];
}

interface EvidenceItemLike {
  id?: string;
  title?: string;
  source?: string;
  source_name?: string;
  type?: string;
  evidence_type?: string;
  date?: string;
  published_at?: string;
  excerpt?: string;
  confidence?: number;
  url?: string;
  clauseIds?: readonly string[];
  nodeIds?: readonly string[];
  companyIds?: readonly string[];
}

interface BackgroundCardLike {
  id?: string;
  title?: string;
  body?: string;
  evidenceIds?: readonly string[];
}

interface ReportNavItemLike {
  id?: string;
  label?: string;
  badge?: string;
}

interface PolicyBriefLike {
  judgement?: string;
  judgment?: string;
  oneLine?: string;
  one_line?: string;
  summary?: string;
  overallSummary?: string;
  overall_summary?: string;
  keyPoints?: readonly string[];
  key_points?: readonly string[];
  points?: readonly string[];
  methodology?: string;
  method?: string;
}

export interface PolicyReportLike {
  id?: string;
  summary?: Partial<PolicySummary>;
  brief?: PolicyBriefLike;
  policyBrief?: PolicyBriefLike;
  policy_brief?: PolicyBriefLike;
  policy?: PolicyMetaLike;
  actions?: readonly PolicyActionLike[];
  clauseGroups?: readonly ClauseGroupLike[];
  clause_groups?: readonly ClauseGroupLike[];
  clauses?: readonly PolicyClauseLike[];
  chainNodes?: readonly IndustryNodeLike[];
  chain_nodes?: readonly IndustryNodeLike[];
  chainEdges?: readonly IndustryEdgeLike[];
  chain_edges?: readonly IndustryEdgeLike[];
  companies?: readonly CompanyImpactLike[];
  evidence?: readonly EvidenceItemLike[];
  backgroundCards?: readonly BackgroundCardLike[];
  background_cards?: readonly BackgroundCardLike[];
  compareRows?: readonly (readonly string[] | PolicyComparisonRow)[];
  compare_rows?: readonly (readonly string[] | PolicyComparisonRow)[];
  modules?: readonly ReportNavItemLike[];
  topTabs?: readonly ReportNavItemLike[];
  top_tabs?: readonly ReportNavItemLike[];
  generatedAt?: string;
  generated_at?: string;
}

const REPORT_STATUSES = new Set<ReportStatus>([
  "published",
  "processing",
  "draft",
  "failed",
  "reviewing",
  "archived"
]);

const JOB_STATUSES = new Set<AnalysisJobStatus>([
  "queued",
  "fetching",
  "extracting",
  "analyzing",
  "published",
  "failed"
]);

const SIGNAL_LABELS: Record<string, PolicySignal> = {
  positive: "positive",
  benefit: "positive",
  beneficial: "positive",
  "\u5229\u597d": "positive",
  constraint: "constraint",
  restriction: "constraint",
  "\u7ea6\u675f": "constraint",
  risk: "risk",
  "\u98ce\u9669": "risk",
  pending: "pending",
  unknown: "pending",
  "\u5f85\u9a8c\u8bc1": "pending",
  neutral: "neutral",
  "\u4e2d\u6027": "neutral"
};

const RELATION_LABELS: Record<string, RelationType> = {
  direct: "direct",
  "\u76f4\u63a5\u76f8\u5173": "direct",
  indirect: "indirect",
  "\u95f4\u63a5\u76f8\u5173": "indirect",
  beneficiary: "beneficiary",
  benefit: "beneficiary",
  "\u6f5c\u5728\u53d7\u76ca": "beneficiary",
  constraint_risk: "constraint_risk",
  risk: "constraint_risk",
  "\u7ea6\u675f\u98ce\u9669": "constraint_risk",
  pending: "pending",
  unknown: "pending",
  "\u5f85\u9a8c\u8bc1": "pending"
};

const EVIDENCE_LABELS: Record<string, EvidenceLevel> = {
  strong: "strong",
  "\u5f3a\u8bc1\u636e": "strong",
  indirect: "indirect",
  "\u95f4\u63a5\u8bc1\u636e": "indirect",
  pending: "pending",
  unknown: "pending",
  "\u5f85\u9a8c\u8bc1": "pending"
};

const SECTION_LABELS = new Set<IndustrySection>([
  "upstream",
  "midstream",
  "downstream",
  "support"
]);

const EDGE_TYPES = new Set<ChainEdgeType>(["strong", "medium", "weak", "risk"]);
const CLAUSE_TONES = new Set<ClauseTone>(["blue", "purple", "green", "orange", "neutral"]);

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function toStringArray(value: readonly string[] | undefined): string[] {
  return Array.isArray(value) ? [...value] : [];
}

function isComparisonTuple(row: readonly string[] | PolicyComparisonRow): row is readonly string[] {
  return Array.isArray(row);
}

export function normalizeReportStatus(
  value: string | null | undefined,
  fallback: ReportStatus = "draft"
): ReportStatus {
  const token = normalizeToken(value);
  return REPORT_STATUSES.has(token as ReportStatus) ? token as ReportStatus : fallback;
}

export function normalizeAnalysisJobStatus(
  value: string | null | undefined,
  fallback: AnalysisJobStatus = "queued"
): AnalysisJobStatus {
  const token = normalizeToken(value);
  return JOB_STATUSES.has(token as AnalysisJobStatus) ? token as AnalysisJobStatus : fallback;
}

export function normalizePolicySignal(
  value: string | null | undefined,
  fallback: PolicySignal = "pending"
): PolicySignal {
  return SIGNAL_LABELS[normalizeToken(value)] ?? fallback;
}

export function normalizeRelationType(
  value: string | null | undefined,
  fallback: RelationType = "pending"
): RelationType {
  return RELATION_LABELS[normalizeToken(value)] ?? fallback;
}

export function normalizeEvidenceLevel(
  value: string | null | undefined,
  fallback: EvidenceLevel = "pending"
): EvidenceLevel {
  return EVIDENCE_LABELS[normalizeToken(value)] ?? fallback;
}

export function normalizeIndustrySection(
  value: string | null | undefined,
  fallback: IndustrySection = "support"
): IndustrySection {
  const token = normalizeToken(value);
  return SECTION_LABELS.has(token as IndustrySection) ? token as IndustrySection : fallback;
}

export function normalizeChainEdgeType(
  value: string | null | undefined,
  fallback: ChainEdgeType = "medium"
): ChainEdgeType {
  const token = normalizeToken(value);
  return EDGE_TYPES.has(token as ChainEdgeType) ? token as ChainEdgeType : fallback;
}

export function normalizeClauseTone(
  value: string | null | undefined,
  fallback: ClauseTone = "neutral"
): ClauseTone {
  const token = normalizeToken(value);
  return CLAUSE_TONES.has(token as ClauseTone) ? token as ClauseTone : fallback;
}

export function mapPolicyRowToSummary(
  row: PolicySummaryRow,
  counts: PolicySummaryCounts = {}
): PolicySummary {
  return {
    id: row.id,
    title: row.title ?? "Untitled policy",
    issuer: row.issuer ?? "Unknown issuer",
    source: row.source ?? row.source_name ?? "Unknown source",
    publishDate: row.publishDate ?? row.publish_date ?? "",
    status: normalizeReportStatus(row.status),
    confidence: clampScore(row.confidence),
    industryCount: counts.industryCount ?? row.industryCount ?? 0,
    companyCount: counts.companyCount ?? row.companyCount ?? 0,
    evidenceCount: counts.evidenceCount ?? row.evidenceCount ?? 0,
    primarySignal: counts.primarySignal ?? row.primarySignal ?? "Pending",
    category: row.category ?? undefined,
    updatedAt: row.updatedAt ?? row.updated_at ?? undefined
  };
}

export function mapAnalysisJobRow(row: AnalysisJobRow): AnalysisJob {
  return {
    id: row.id,
    policyId: row.policy_id ?? undefined,
    title: row.title ?? "Untitled policy",
    sourceUrl: row.source_url ?? "",
    sourceName: row.source_name ?? "Manual input",
    status: normalizeAnalysisJobStatus(row.status),
    progress: clampPercent(row.progress),
    createdAt: row.created_at ?? "",
    currentStep: row.current_step ?? "Waiting",
    errorMessage: row.error_message ?? undefined
  };
}

export function mapPolicyMeta(input: PolicyMetaLike = {}): PolicyMeta {
  return {
    title: input.title ?? "Untitled policy",
    status: input.status ?? "draft",
    issuer: input.issuer ?? "Unknown issuer",
    publishDate: input.publishDate ?? input.publish_date ?? "",
    effectiveDate: input.effectiveDate ?? input.effective_date ?? "",
    source: input.source ?? input.sourceName ?? input.source_name ?? "Unknown source",
    category: input.category ?? "",
    level: input.level ?? input.policyLevel ?? input.policy_level ?? "",
    confidence: clampScore(input.confidence),
    sourceUrl: input.sourceUrl ?? input.source_url,
    jurisdiction: input.jurisdiction,
    tags: input.tags ? [...input.tags] : undefined
  };
}

export function mapPolicyActions(items: readonly PolicyActionLike[] = []): PolicyAction[] {
  return items.map((item, index) => ({
    id: item.id ?? `action-${index + 1}`,
    title: item.title ?? "",
    body: item.body ?? "",
    signal: normalizePolicySignal(item.signal),
    displaySignal: item.signal,
    confidence: clampScore(item.confidence),
    clauseIds: toStringArray(item.clauseIds ?? item.clauses),
    sortOrder: item.sortOrder ?? item.sort_order ?? index
  }));
}

export function mapClauseGroups(items: readonly ClauseGroupLike[] = []): ClauseGroup[] {
  return items.map((item, index) => ({
    id: item.id ?? `clause-group-${index + 1}`,
    title: item.title ?? "",
    count: item.count ?? 0,
    tone: normalizeClauseTone(item.tone)
  }));
}

export function mapPolicyClauses(items: readonly PolicyClauseLike[] = []): PolicyClause[] {
  return items.map((item, index) => ({
    id: item.id ?? `clause-${index + 1}`,
    no: item.no ?? item.clause_no ?? "",
    title: item.title ?? "",
    group: item.group ?? item.clause_group ?? "",
    excerpt: item.excerpt ?? "",
    fullText: item.fullText ?? item.full_text,
    confidence: clampScore(item.confidence),
    keywords: toStringArray(item.keywords),
    industries: toStringArray(item.industries),
    sortOrder: item.sortOrder ?? item.sort_order ?? index
  }));
}

export function mapIndustryNodes(items: readonly IndustryNodeLike[] = []): IndustryNode[] {
  return items.map((item, index) => {
    const evidenceLabel = item.evidenceLevel ?? item.evidence_level ?? item.evidence;

    return {
      id: item.id ?? item.node_key ?? `node-${index + 1}`,
      title: item.title ?? "",
      subtitle: item.subtitle ?? "",
      section: normalizeIndustrySection(item.section),
      relation: normalizeRelationType(item.relation),
      evidenceLevel: normalizeEvidenceLevel(evidenceLabel),
      confidence: clampScore(item.confidence),
      description: item.description ?? "",
      clauseIds: toStringArray(item.clauseIds ?? item.clause_refs ?? item.clauses),
      companyIds: toStringArray(item.companyIds ?? item.company_refs ?? item.companies),
      iconKey: item.iconKey,
      displayRelation: item.relation,
      displayEvidenceLevel: evidenceLabel
    };
  });
}

export function mapIndustryEdges(items: readonly IndustryEdgeLike[] = []): IndustryEdge[] {
  return items.map((item) => ({
    from: item.from ?? item.from_node_id ?? "",
    to: item.to ?? item.to_node_id ?? "",
    type: normalizeChainEdgeType(item.type ?? item.edge_type),
    confidence: item.confidence === undefined ? undefined : clampScore(item.confidence)
  }));
}

export function mapCompanyImpacts(items: readonly CompanyImpactLike[] = []): CompanyImpact[] {
  return items.map((item, index) => {
    const evidenceLabel = item.evidenceLevel ?? item.evidence_level ?? item.evidence;

    return {
      id: item.id ?? item.company_key ?? `company-${index + 1}`,
      name: item.name ?? "",
      ticker: item.ticker ?? "",
      exchange: item.exchange,
      platform: item.platform ?? "",
      status: item.status ?? "",
      section: normalizeIndustrySection(item.section),
      relation: normalizeRelationType(item.relation),
      evidenceLevel: normalizeEvidenceLevel(evidenceLabel),
      confidence: clampScore(item.confidence),
      evidenceCount: item.evidenceCount ?? item.evidence_count ?? 0,
      products: toStringArray(item.products),
      reason: item.reason ?? "",
      uncertainty: item.uncertainty ?? "",
      nodeIds: toStringArray(item.nodeIds ?? item.node_ids),
      displayRelation: item.relation,
      displayEvidenceLevel: evidenceLabel
    };
  });
}

export function mapEvidenceItems(items: readonly EvidenceItemLike[] = []): EvidenceItem[] {
  return items.map((item, index) => ({
    id: item.id ?? `evidence-${index + 1}`,
    title: item.title ?? "",
    source: item.source ?? item.source_name ?? "",
    type: item.type ?? item.evidence_type ?? "",
    date: item.date ?? item.published_at ?? "",
    excerpt: item.excerpt ?? "",
    confidence: clampScore(item.confidence),
    url: item.url,
    links: {
      clauseIds: toStringArray(item.clauseIds),
      nodeIds: toStringArray(item.nodeIds),
      companyIds: toStringArray(item.companyIds)
    }
  }));
}

export function mapBackgroundCards(
  items: readonly BackgroundCardLike[] = []
): PolicyBackgroundCard[] {
  return items.map((item, index) => ({
    id: item.id ?? `background-${index + 1}`,
    title: item.title ?? "",
    body: item.body ?? "",
    evidenceIds: toStringArray(item.evidenceIds)
  }));
}

export function mapComparisonRows(
  rows: readonly (readonly string[] | PolicyComparisonRow)[] = []
): PolicyComparisonRow[] {
  return rows.map((row, index) => {
    if (!isComparisonTuple(row)) return row;

    const [dimension = "", ...values] = row;
    return {
      id: `compare-${index + 1}`,
      dimension,
      values
    };
  });
}

export function mapReportNavItems(items: readonly ReportNavItemLike[] = []): ReportNavItem[] {
  return items.map((item, index) => ({
    id: item.id ?? `module-${index + 1}`,
    label: item.label ?? "",
    badge: item.badge
  }));
}

export function mapPolicyReport(input: PolicyReportLike): PolicyReport {
  const id = input.id ?? input.summary?.id ?? "policy-report";
  const brief = mapPolicyBrief(input.brief ?? input.policyBrief ?? input.policy_brief);
  const policy = mapPolicyMeta(input.policy);
  const actions = mapPolicyActions(input.actions);
  const clauseGroups = mapClauseGroups(input.clauseGroups ?? input.clause_groups);
  const clauses = mapPolicyClauses(input.clauses);
  const chainNodes = mapIndustryNodes(input.chainNodes ?? input.chain_nodes);
  const chainEdges = mapIndustryEdges(input.chainEdges ?? input.chain_edges);
  const companies = mapCompanyImpacts(input.companies);
  const evidence = mapEvidenceItems(input.evidence);

  const reportForSummary = {
    id,
    policy,
    actions,
    chainNodes,
    companies,
    evidence
  };

  return {
    id,
    summary: {
      ...createPolicySummary(reportForSummary),
      ...input.summary,
      id
    },
    brief,
    policy,
    actions,
    clauseGroups,
    clauses,
    chainNodes,
    chainEdges,
    companies,
    evidence,
    backgroundCards: mapBackgroundCards(input.backgroundCards ?? input.background_cards),
    compareRows: mapComparisonRows(input.compareRows ?? input.compare_rows),
    modules: mapReportNavItems(input.modules),
    topTabs: mapReportNavItems(input.topTabs ?? input.top_tabs),
    generatedAt: input.generatedAt ?? input.generated_at
  };
}

function mapPolicyBrief(input?: PolicyBriefLike): PolicyReport["brief"] {
  if (!input) return undefined;
  const judgement = input.judgement ?? input.judgment ?? input.oneLine ?? input.one_line ?? input.summary;
  if (!judgement) return undefined;

  return {
    judgement,
    summary: input.summary ?? input.overallSummary ?? input.overall_summary,
    keyPoints: toStringArray(input.keyPoints ?? input.key_points ?? input.points),
    methodology: input.methodology ?? input.method
  };
}

const REPORT_PAYLOAD_KEYS = [
  "reportPayload",
  "report_payload",
  "policyReport",
  "policy_report",
  "report",
  "payload",
  "analysisPayload",
  "analysis_payload",
  "outputPayload",
  "output_payload"
];

const REPORT_NESTED_PAYLOAD_KEYS = [
  "payload",
  "analysisPayload",
  "analysis_payload",
  "outputPayload",
  "output_payload"
];

const DEFAULT_MODULES: AppPolicyReport["modules"] = [
  { id: "brief", label: "政策速读" },
  { id: "industry", label: "产业链影响", badge: "NEW" },
  { id: "clauses", label: "政策条款" },
  { id: "background", label: "政策背景" },
  { id: "compare", label: "对比分析" },
  { id: "companies", label: "公司影响分析" },
  { id: "evidence", label: "证据链总览" }
];

const DEFAULT_TOP_TABS: AppPolicyReport["topTabs"] = [
  { id: "brief", label: "政策总览" },
  { id: "clauses", label: "政策条款" },
  { id: "background", label: "政策背景" },
  { id: "compare", label: "对比分析" }
];

const KNOWN_MODULE_IDS = new Set<AppModuleId>([
  "brief",
  "industry",
  "clauses",
  "background",
  "compare",
  "companies",
  "evidence"
]);

const APP_SIGNAL_LABELS: Record<string, AppSignal> = {
  positive: "利好",
  benefit: "利好",
  beneficial: "利好",
  "利好": "利好",
  constraint: "约束",
  restriction: "约束",
  "约束": "约束",
  risk: "风险",
  "风险": "风险",
  pending: "待验证",
  unknown: "待验证",
  neutral: "待验证",
  "待验证": "待验证",
  "中性": "待验证"
};

const APP_RELATION_LABELS: Record<string, AppChainNode["relation"]> = {
  direct: "直接相关",
  "直接相关": "直接相关",
  indirect: "间接相关",
  "间接相关": "间接相关",
  beneficiary: "潜在受益",
  benefit: "潜在受益",
  beneficial: "潜在受益",
  "潜在受益": "潜在受益",
  constraint: "约束风险",
  constraint_risk: "约束风险",
  risk: "约束风险",
  "约束风险": "约束风险",
  pending: "待验证",
  unknown: "待验证",
  neutral: "待验证",
  "待验证": "待验证"
};

const APP_EVIDENCE_LABELS: Record<string, AppChainNode["evidence"]> = {
  strong: "强证据",
  high: "强证据",
  "强证据": "强证据",
  indirect: "间接证据",
  medium: "间接证据",
  "间接证据": "间接证据",
  pending: "待验证",
  low: "待验证",
  unknown: "待验证",
  "待验证": "待验证"
};

const ICONS_BY_KEY: Record<string, LucideIcon> = {
  badge: BadgeCheck,
  badgecheck: BadgeCheck,
  building: Building2,
  building2: Building2,
  city: Building2,
  database: Database,
  data: Database,
  factory: Factory,
  manufacturing: Factory,
  file: FileText,
  filetext: FileText,
  landmark: Landmark,
  finance: Landmark,
  layers: Layers3,
  layers3: Layers3,
  storage: Layers3,
  network: Network,
  shield: ShieldCheck,
  shieldcheck: ShieldCheck,
  security: ShieldCheck,
  sparkles: Sparkles,
  talent: Sparkles,
  workflow: Workflow,
  exchange: Workflow
};

const SECTION_ICONS: Record<AppChainNode["section"], LucideIcon> = {
  upstream: Database,
  midstream: Workflow,
  downstream: Factory,
  support: ShieldCheck
};

export function extractPolicyReportPayload(metadata: unknown): JsonRecord | null {
  const root = asJsonRecord(metadata);
  if (!root) return null;

  for (const key of REPORT_PAYLOAD_KEYS) {
    const candidate = asJsonRecord(root[key]);
    if (candidate && isPolicyReportPayload(candidate)) return candidate;
  }

  for (const key of REPORT_NESTED_PAYLOAD_KEYS) {
    const container = asJsonRecord(root[key]);
    if (!container) continue;

    if (isPolicyReportPayload(container)) return container;

    for (const nestedKey of REPORT_PAYLOAD_KEYS) {
      const candidate = asJsonRecord(container[nestedKey]);
      if (candidate && isPolicyReportPayload(candidate)) return candidate;
    }
  }

  return isPolicyReportPayload(root) ? root : null;
}

export function mapPolicyReportPayloadForApp(
  input: JsonRecord,
  context: AppPolicyReportContext = {}
): AppPolicyReport {
  const summaryInput = asJsonRecord(input.summary);
  const policyInput = asJsonRecord(input.policy) ?? input;
  const id = firstString(input.id, summaryInput?.id, context.id) || "policy-report";
  const policy = mapAppPolicyMeta(policyInput, context);
  const brief = mapAppPolicyBrief(asJsonRecord(input.brief ?? input.policyBrief ?? input.policy_brief));
  const actions = mapAppPolicyActions(toRecordArray(input.actions));
  const clauseGroups = mapAppClauseGroups(toRecordArray(input.clauseGroups ?? input.clause_groups));
  const clauses = mapAppClauses(toRecordArray(input.clauses));
  const chainNodes = mapAppChainNodes(toRecordArray(input.chainNodes ?? input.chain_nodes));
  const chainEdges = mapAppChainEdges(toRecordArray(input.chainEdges ?? input.chain_edges));
  const companies = mapAppCompanies(toRecordArray(input.companies));
  const evidence = mapAppEvidence(toRecordArray(input.evidence));
  const backgroundCards = normalizeAppBackgroundCards(
    mapAppBackgroundCards(toRecordArray(input.backgroundCards ?? input.background_cards)),
    policy
  );
  const compareRows = normalizeAppCompareRows(mapAppCompareRows(toArray(input.compareRows ?? input.compare_rows)));
  const compareInsights = mapAppCompareInsights(
    asJsonRecord(input.compareInsights ?? input.compare_insights),
    compareRows
  );
  const analysisCoverage = mapAppAnalysisCoverage(asJsonRecord(input.analysisCoverage ?? input.analysis_coverage));
  const fallbackSummary: PolicySummary = {
    id,
    title: policy.title,
    issuer: policy.issuer,
    source: policy.source,
    publishDate: policy.publishDate,
    status: normalizeReportStatus(firstString(context.status, summaryInput?.status)),
    confidence: policy.confidence,
    industryCount: chainNodes.length,
    companyCount: companies.length,
    evidenceCount: evidence.length,
    primarySignal: chainNodes[0]?.title ?? "",
    category: policy.category
  };

  return {
    id,
    summary: {
      ...fallbackSummary,
      ...readSummary(summaryInput),
      ...context.summary,
      id
    },
    brief,
    policy,
    actions,
    clauseGroups,
    clauses,
    chainNodes,
    chainEdges,
    companies,
    evidence,
    backgroundCards,
    compareRows,
    compareInsights,
    analysisCoverage,
    modules: mapAppNavItems(toRecordArray(input.modules), DEFAULT_MODULES),
    topTabs: mapAppNavItems(toRecordArray(input.topTabs ?? input.top_tabs), DEFAULT_TOP_TABS),
    generatedAt: firstString(input.generatedAt, input.generated_at)
  };
}

function mapAppPolicyBrief(input: JsonRecord | null): AppPolicyReport["brief"] {
  if (!input) return undefined;
  const judgement = firstString(input.judgement, input.judgment, input.oneLine, input.one_line, input.summary);
  if (!judgement) return undefined;

  return {
    judgement,
    summary: firstString(input.summary, input.overallSummary, input.overall_summary),
    keyPoints: toStringList(input.keyPoints, input.key_points, input.points),
    methodology: firstString(input.methodology, input.method)
  };
}

function isPolicyReportPayload(value: JsonRecord): boolean {
  const hasPolicyLikeShape = Boolean(
    asJsonRecord(value.policy) ||
      asJsonRecord(value.summary) ||
      firstString(value.title)
  );
  const hasReportSections = Boolean(
    Array.isArray(value.actions) ||
      Array.isArray(value.clauses) ||
      Array.isArray(value.chainNodes) ||
      Array.isArray(value.chain_nodes) ||
      Array.isArray(value.companies) ||
      Array.isArray(value.evidence)
  );

  return hasPolicyLikeShape && hasReportSections;
}

function mapAppPolicyMeta(input: JsonRecord, context: AppPolicyReportContext): AppPolicyMeta {
  return {
    title: firstString(input.title, context.title) || "Untitled policy",
    status: firstString(input.status, context.status) || "draft",
    issuer: firstString(input.issuer, context.issuer) || "Unknown issuer",
    publishDate: firstString(input.publishDate, input.publish_date, context.publishDate) || "",
    effectiveDate: firstString(input.effectiveDate, input.effective_date, context.effectiveDate) || "",
    source: firstString(input.source, input.sourceName, input.source_name, context.sourceName) || "Unknown source",
    category: firstString(input.category, context.category) || "",
    level: firstString(input.level, input.policyLevel, input.policy_level, context.policyLevel) || "",
    confidence: firstNumber(input.confidence, context.confidence),
    sourceUrl: firstString(input.sourceUrl, input.source_url, context.sourceUrl),
    scope: firstString(input.scope),
    impactScope: firstString(input.impactScope, input.impact_scope),
    jurisdiction: firstString(input.jurisdiction),
    tags: toStringList(input.tags)
  };
}

function mapAppPolicyActions(items: JsonRecord[]): AppPolicyAction[] {
  return items.map((item, index) => ({
    id: firstString(item.id, item.action_key) || `action-${index + 1}`,
    title: firstString(item.title) || "",
    body: firstString(item.body, item.description) || "",
    signal: normalizeAppSignal(item.signal),
    confidence: firstNumber(item.confidence)
  }));
}

function mapAppClauseGroups(items: JsonRecord[]): AppClauseGroup[] {
  return items.map((item, index) => ({
    id: firstString(item.id, item.group_key) || `clause-group-${index + 1}`,
    title: firstString(item.title, item.name) || "",
    count: firstNumber(item.count),
    tone: normalizeAppClauseTone(item.tone)
  }));
}

function mapAppClauses(items: JsonRecord[]): AppClause[] {
  return items.map((item, index) => ({
    id: firstString(item.id, item.clause_key) || `clause-${index + 1}`,
    no: firstString(item.no, item.clause_no) || "",
    title: firstString(item.title) || "",
    group: firstString(item.group, item.clause_group) || "",
    excerpt: firstString(item.excerpt, item.summary, item.body) || "",
    confidence: firstNumber(item.confidence),
    keywords: toStringList(item.keywords),
    industries: toStringList(item.industries)
  }));
}

function mapAppChainNodes(items: JsonRecord[]): AppChainNode[] {
  return items.map((item, index) => {
    const section = normalizeAppIndustrySection(item.section);
    return {
      id: firstString(item.id, item.node_key) || `node-${index + 1}`,
      title: firstString(item.title, item.name) || "",
      subtitle: firstString(item.subtitle) || "",
      section,
      relation: normalizeAppRelation(item.relation),
      evidence: normalizeAppEvidenceLabel(item.evidence, item.evidenceLevel, item.evidence_level),
      confidence: firstNumber(item.confidence),
      description: firstString(item.description, item.body) || "",
      clauses: toStringList(item.clauses, item.clauseIds, item.clause_ids, item.clause_refs),
      companies: toStringList(item.companies, item.companyIds, item.company_ids, item.company_refs),
      evidenceIds: toStringList(item.evidenceIds, item.evidence_ids, item.evidence_refs),
      impactReason: firstString(item.impactReason, item.impact_reason),
      icon: resolveIcon(item, section)
    };
  });
}

function mapAppChainEdges(items: JsonRecord[]): AppChainEdge[] {
  return items.map((item) => ({
    from: firstString(item.from, item.from_node_id, item.fromNodeId) || "",
    to: firstString(item.to, item.to_node_id, item.toNodeId) || "",
    type: normalizeAppChainEdgeType(item.type, item.edge_type),
    confidence: firstNumberOrUndefined(item.confidence),
    reason: firstString(item.reason)
  }));
}

function mapAppCompanies(items: JsonRecord[]): AppCompany[] {
  return items.map((item, index) => {
    const confidence = firstNumber(item.confidence);
    return {
      id: firstString(item.id, item.company_key) || `company-${index + 1}`,
      name: firstString(item.name, item.companyName, item.company_name) || "",
      ticker: firstString(item.ticker, item.symbol) || "",
      platform: firstString(item.platform, item.business, item.segment) || "",
      status: firstString(item.status) || "",
      section: normalizeAppIndustrySection(item.section),
      relation: normalizeAppRelation(item.relation),
      evidence: normalizeAppEvidenceLabel(item.evidence, item.evidenceLevel, item.evidence_level),
      confidence,
      policyRelevance: firstNumber(item.policyRelevance, item.policy_relevance, confidence),
      evidenceCertainty: firstNumber(item.evidenceCertainty, item.evidence_certainty, confidence),
      evidenceCount: firstPlainNumber(
        item.evidenceCount,
        item.evidence_count,
        toStringList(item.evidenceIds, item.evidence_ids, item.evidenceRefs, item.evidence_refs).length
      ),
      products: toStringList(item.products),
      nodeIds: toStringList(item.nodeIds, item.node_ids, item.nodes),
      clauseIds: toStringList(item.clauseIds, item.clause_ids, item.clauses),
      evidenceIds: toStringList(item.evidenceIds, item.evidence_ids, item.evidenceRefs, item.evidence_refs),
      reason: firstString(item.reason, item.description) || "",
      uncertainty: firstString(item.uncertainty, item.risk_note, item.riskNote) || "",
      opportunity: firstString(item.opportunity),
      riskFactors: toStringList(item.riskFactors, item.risk_factors),
      sourceUrls: toStringList(item.sourceUrls, item.source_urls)
    };
  });
}

function mapAppEvidence(items: JsonRecord[]): AppEvidence[] {
  return items.map((item, index) => {
    const links = asJsonRecord(item.links);
    return {
      id: firstString(item.id, item.evidence_key) || `evidence-${index + 1}`,
      title: firstString(item.title, item.name) || "",
      source: firstString(item.source, item.source_name) || "",
      type: firstString(item.type, item.evidence_type) || "",
      date: firstString(item.date, item.published_at, item.publish_date) || "",
      excerpt: firstString(item.excerpt, item.summary, item.body) || "",
      confidence: firstNumber(item.confidence),
      url: firstString(item.url, item.sourceUrl, item.source_url),
      clauseIds: toStringList(item.clauseIds, item.clause_ids, links?.clauseIds, links?.clause_ids),
      nodeIds: toStringList(item.nodeIds, item.node_ids, links?.nodeIds, links?.node_ids),
      companyIds: toStringList(item.companyIds, item.company_ids, links?.companyIds, links?.company_ids)
    };
  });
}

function mapAppBackgroundCards(items: JsonRecord[]): AppPolicyReport["backgroundCards"] {
  return items.map((item) => ({
    title: firstString(item.title, item.name) || "",
    body: firstString(item.body, item.description, item.summary) || ""
  }));
}

function normalizeAppBackgroundCards(
  cards: AppPolicyReport["backgroundCards"],
  policy: AppPolicyMeta
): AppPolicyReport["backgroundCards"] {
  const scope = policy.scope || policy.impactScope || policy.jurisdiction || inferAppPolicyScope(policy);
  const nextCards = cards.map((card) => {
    if (card.title !== "影响范围") return card;
    return {
      ...card,
      body: card.body || `本政策影响范围判断为：${scope}。`
    };
  });

  if (!nextCards.some((card) => card.title === "影响范围")) {
    nextCards.splice(1, 0, {
      title: "影响范围",
      body: `本政策影响范围判断为：${scope}。`
    });
  }

  return nextCards;
}

function mapAppCompareRows(rows: unknown[]): string[][] {
  return rows.map((row, index) => {
    if (Array.isArray(row)) {
      return row.map((cell) => String(cell ?? ""));
    }

    const record = asJsonRecord(row);
    if (!record) return [`compare-${index + 1}`];

    return [
      firstString(record.dimension, record.title, record.name) || `compare-${index + 1}`,
      ...(
        toStringList(record.values).length
          ? toStringList(record.values)
          : [
              firstString(record.current, record.currentValue, record.current_value) || "",
              firstString(record.similar, record.similarValue, record.similar_value, record.baseline) || "",
              firstString(record.different, record.differentValue, record.different_value, record.contrast) || ""
            ].filter(Boolean)
      )
    ];
  });
}

function normalizeAppCompareRows(rows: string[][]): string[][] {
  return rows.map((row, index) => {
    const [dimension, ...values] = row;
    return [dimension || `对比维度${index + 1}`, ...values].slice(0, 4);
  });
}

function mapAppCompareInsights(
  input: JsonRecord | null,
  compareRows: string[][]
): AppCompareInsights | undefined {
  if (!input && compareRows.length === 0) return undefined;

  const rawRows = input
    ? toArray(input.rows ?? input.dimensions ?? input.compareRows ?? input.compare_rows)
    : [];
  const rows = mapAppCompareInsightRows(rawRows.length > 0 ? rawRows : compareRows);
  const similarPolicies = input
    ? mapAppComparePolicies(toRecordArray(input.similarPolicies ?? input.similar_policies))
    : [];
  const contrastPolicies = input
    ? mapAppComparePolicies(toRecordArray(input.contrastPolicies ?? input.contrast_policies ?? input.differentPolicies ?? input.different_policies))
    : [];
  const similarPolicy = input
    ? mapAppComparePolicy(asJsonRecord(input.similarPolicy ?? input.similar_policy) ?? null) ?? similarPolicies[0] ?? null
    : null;
  const differencePolicy = input
    ? mapAppComparePolicy(asJsonRecord(input.differencePolicy ?? input.difference_policy ?? input.contrastPolicy ?? input.contrast_policy) ?? null) ?? contrastPolicies[0] ?? null
    : null;
  const similarityPoints = input ? toStringList(input.similarityPoints, input.similarity_points) : [];
  const differencePoints = input ? toStringList(input.differencePoints, input.difference_points) : [];

  return {
    status: input ? firstString(input.status) : undefined,
    basis: input ? firstString(input.basis, input.method) : undefined,
    method: input ? firstString(input.method) : undefined,
    emptyReason: input ? firstString(input.emptyReason, input.empty_reason) : undefined,
    comparableCount: input ? firstPlainNumber(input.comparableCount, input.comparable_count) : undefined,
    similarPolicy,
    differencePolicy,
    similarPolicies,
    contrastPolicies,
    similarityPoints: similarityPoints.length
      ? similarityPoints
      : similarPolicies.map((item) => `与《${item.title}》形成相似基准${item.reason ? `：${item.reason}` : "。"}`),
    differencePoints: differencePoints.length
      ? differencePoints
      : contrastPolicies.map((item) => `与《${item.title}》形成差异基准${item.reason ? `：${item.reason}` : "。"}`),
    rows
  };
}

function mapAppComparePolicies(items: JsonRecord[]): NonNullable<AppCompareInsights["similarPolicies"]> {
  return items.map((item) => mapAppComparePolicy(item)).filter((item): item is NonNullable<AppCompareInsights["similarPolicy"]> => Boolean(item));
}

function mapAppComparePolicy(item: JsonRecord | null): NonNullable<AppCompareInsights["similarPolicy"]> | null {
  if (!item) return null;
  const title = firstString(item.title, item.name);
  if (!title) return null;

  return {
    id: firstString(item.id, item.policyId, item.policy_id),
    title,
    issuer: firstString(item.issuer),
    source: firstString(item.source, item.sourceName, item.source_name, item.category),
    publishDate: firstString(item.publishDate, item.publish_date),
    similarity: firstNumberOrUndefined(item.similarity, item.score),
    reason: firstString(item.reason, item.basis)
  };
}

function mapAppCompareInsightRows(rows: unknown[]): AppCompareInsights["rows"] {
  return rows.map((row, index) => {
    if (Array.isArray(row)) {
      const [dimension = "", current = "", similar = "", different = ""] = row;
      return {
        id: `compare-${index + 1}`,
        dimension: String(dimension || `对比维度${index + 1}`),
        current: String(current ?? ""),
        similar: String(similar ?? ""),
        different: String(different ?? "")
      };
    }

    const record = asJsonRecord(row);
    if (!record) {
      return {
        id: `compare-${index + 1}`,
        dimension: `对比维度${index + 1}`,
        current: "",
        similar: "",
        different: ""
      };
    }

    const values = toStringList(record.values);
    return {
      id: firstString(record.id) || `compare-${index + 1}`,
      dimension: firstString(record.dimension, record.title, record.name) || `对比维度${index + 1}`,
      current: firstString(record.current, record.currentValue, record.current_value) || values[0] || "",
      similar: firstString(record.similar, record.similarValue, record.similar_value, record.baseline) || values[1] || "",
      different: firstString(record.different, record.differentValue, record.different_value, record.contrast) || values[2] || "",
      explanation: firstString(record.explanation, record.reason),
      clauseIds: toStringList(record.clauseIds, record.clause_ids),
      evidenceIds: toStringList(record.evidenceIds, record.evidence_ids)
    };
  });
}

function mapAppAnalysisCoverage(input: JsonRecord | null): AppAnalysisCoverage | undefined {
  if (!input) return undefined;

  return {
    status: firstString(input.status),
    textLength: firstPlainNumber(input.textLength, input.text_length),
    clauseCount: firstPlainNumber(input.clauseCount, input.clause_count),
    actionCount: firstPlainNumber(input.actionCount, input.action_count),
    evidenceCount: firstPlainNumber(input.evidenceCount, input.evidence_count),
    industryNodeCount: firstPlainNumber(input.industryNodeCount, input.industry_node_count, input.industryRuleCount, input.industry_rule_count),
    companyCount: firstPlainNumber(input.companyCount, input.company_count, input.companyCandidateCount, input.company_candidate_count),
    matchedKeywordCount: firstPlainNumber(input.matchedKeywordCount, input.matched_keyword_count),
    comparablePolicyCount: firstPlainNumber(input.comparablePolicyCount, input.comparable_policy_count),
    limitations: toStringList(input.limitations)
  };
}

function inferAppPolicyScope(policy: AppPolicyMeta): string {
  const text = `${policy.title} ${policy.issuer} ${policy.level} ${policy.source}`;
  const provinceMatch = text.match(/(北京市|天津市|上海市|重庆市|河北省|山西省|辽宁省|吉林省|黑龙江省|江苏省|浙江省|安徽省|福建省|江西省|山东省|河南省|湖北省|湖南省|广东省|海南省|四川省|贵州省|云南省|陕西省|甘肃省|青海省|台湾省|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|香港特别行政区|澳门特别行政区)/);
  if (provinceMatch) return provinceMatch[1];
  if (/国务院|中共中央|全国|国家|中国政府网|国家发展改革委|国家数据局|工业和信息化部|部委/.test(text)) return "全国";
  return "以政策发布机关管辖范围为准";
}

function mapAppNavItems<T extends AppPolicyReport["modules"] | AppPolicyReport["topTabs"]>(
  items: JsonRecord[],
  fallback: T
): T {
  if (items.length === 0) return fallback;

  return items.map((item, index) => ({
    id: normalizeAppModuleId(item.id, fallback[index]?.id ?? "brief"),
    label: firstString(item.label, item.title, item.name) || fallback[index]?.label || "",
    badge: firstString(item.badge)
  })) as T;
}

function readSummary(input: JsonRecord | null | undefined): Partial<PolicySummary> {
  if (!input) return {};

  const summary: Partial<PolicySummary> = {};
  const title = firstString(input.title);
  const issuer = firstString(input.issuer);
  const source = firstString(input.source, input.sourceName, input.source_name);
  const publishDate = firstString(input.publishDate, input.publish_date);
  const status = firstString(input.status);
  const confidence = firstNumberOrUndefined(input.confidence);
  const industryCount = firstNumberOrUndefined(input.industryCount, input.industry_count);
  const companyCount = firstNumberOrUndefined(input.companyCount, input.company_count);
  const evidenceCount = firstNumberOrUndefined(input.evidenceCount, input.evidence_count);
  const primarySignal = firstString(input.primarySignal, input.primary_signal);
  const category = firstString(input.category);
  const updatedAt = firstString(input.updatedAt, input.updated_at);

  if (title) summary.title = title;
  if (issuer) summary.issuer = issuer;
  if (source) summary.source = source;
  if (publishDate) summary.publishDate = publishDate;
  if (status) summary.status = normalizeReportStatus(status);
  if (confidence !== undefined) summary.confidence = confidence;
  if (industryCount !== undefined) summary.industryCount = industryCount;
  if (companyCount !== undefined) summary.companyCount = companyCount;
  if (evidenceCount !== undefined) summary.evidenceCount = evidenceCount;
  if (primarySignal) summary.primarySignal = primarySignal;
  if (category) summary.category = category;
  if (updatedAt) summary.updatedAt = updatedAt;

  return summary;
}

function normalizeAppSignal(value: unknown): AppSignal {
  return APP_SIGNAL_LABELS[normalizeToken(toMaybeString(value))] ?? "待验证";
}

function normalizeAppRelation(value: unknown): AppChainNode["relation"] {
  return APP_RELATION_LABELS[normalizeToken(toMaybeString(value))] ?? "待验证";
}

function normalizeAppEvidenceLabel(...values: unknown[]): AppChainNode["evidence"] {
  for (const value of values) {
    const label = APP_EVIDENCE_LABELS[normalizeToken(toMaybeString(value))];
    if (label) return label;
  }

  return "待验证";
}

function normalizeAppIndustrySection(value: unknown): AppChainNode["section"] {
  const token = normalizeToken(toMaybeString(value));
  return SECTION_LABELS.has(token as AppChainNode["section"]) ? token as AppChainNode["section"] : "support";
}

function normalizeAppChainEdgeType(...values: unknown[]): AppChainEdge["type"] {
  for (const value of values) {
    const token = normalizeToken(toMaybeString(value));
    if (EDGE_TYPES.has(token as AppChainEdge["type"])) return token as AppChainEdge["type"];
  }

  return "medium";
}

function normalizeAppClauseTone(value: unknown): AppClauseGroup["tone"] {
  const token = normalizeToken(toMaybeString(value));
  return token === "purple" || token === "green" || token === "orange" ? token : "blue";
}

function normalizeAppModuleId(value: unknown, fallback: AppModuleId): AppModuleId {
  const token = normalizeToken(toMaybeString(value));
  return KNOWN_MODULE_IDS.has(token as AppModuleId) ? token as AppModuleId : fallback;
}

function resolveIcon(item: JsonRecord, section: AppChainNode["section"]): LucideIcon {
  const key = normalizeToken(firstString(item.iconKey, item.icon_key, item.icon));
  return ICONS_BY_KEY[key] ?? SECTION_ICONS[section];
}

function asJsonRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function toRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asJsonRecord).filter((item): item is JsonRecord => Boolean(item)) : [];
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toStringList(...values: unknown[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item ?? "").trim()).filter(Boolean);
    }
  }

  return [];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = toMaybeString(value);
    if (text) return text;
  }

  return undefined;
}

function firstPlainNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
    }
  }

  return 0;
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return clampScore(value);
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return clampScore(parsed);
    }
  }

  return 0;
}

function firstNumberOrUndefined(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return clampScore(value);
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return clampScore(parsed);
    }
  }

  return undefined;
}

function toMaybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
