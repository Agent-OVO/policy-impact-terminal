import {
  actions,
  backgroundCards,
  chainEdges,
  chainNodes,
  clauses,
  clauseGroups,
  companies,
  compareRows,
  evidence,
  modules,
  policy,
  topTabs
} from "../data/policy";
import { extractPolicyReportPayload, mapPolicyReportPayloadForApp } from "./reportMappers";
import { isSupabaseConfigured, supabase } from "./supabase";

export type ReportStatus = "published" | "processing" | "draft" | "failed" | "reviewing" | "archived";
export type JobStatus = "queued" | "fetching" | "extracting" | "analyzing" | "published" | "failed";

export interface PolicySummary {
  id: string;
  title: string;
  issuer: string;
  source: string;
  publishDate: string;
  status: ReportStatus;
  confidence: number;
  industryCount: number;
  companyCount: number;
  evidenceCount: number;
  primarySignal: string;
}

export interface AnalysisJob {
  id: string;
  title: string;
  sourceUrl: string;
  sourceName: string;
  status: JobStatus;
  progress: number;
  createdAt: string;
  currentStep: string;
}

export interface CreateAnalysisJobInput {
  sourceUrl: string;
  title: string;
  sourceName?: string;
  sourceKey?: string;
  issuer?: string;
  publishDate?: string;
  policyNo?: string;
  canonicalSourceUrl?: string;
  contentHash?: string;
  externalId?: string;
  inputPayload?: Record<string, unknown>;
}

export interface PolicyReport {
  id: string;
  summary: PolicySummary;
  policy: typeof policy;
  actions: typeof actions;
  clauseGroups: typeof clauseGroups;
  clauses: typeof clauses;
  chainNodes: typeof chainNodes;
  chainEdges: typeof chainEdges;
  companies: typeof companies;
  evidence: typeof evidence;
  backgroundCards: typeof backgroundCards;
  compareRows: typeof compareRows;
  modules: typeof modules;
  topTabs: typeof topTabs;
}

export interface ReportRepository {
  listPolicyReports(): Promise<PolicySummary[]>;
  getPolicyReport(reportId: string): Promise<PolicyReport>;
  listAnalysisJobs(): Promise<AnalysisJob[]>;
  createAnalysisJob(input: CreateAnalysisJobInput): Promise<AnalysisJob>;
}

type RepositoryOperation =
  | "listPolicyReports"
  | "getPolicyReport"
  | "listAnalysisJobs"
  | "createAnalysisJob"
  | "invokeIngestFunction";

type JsonRecord = Record<string, unknown>;

type SupabasePolicyRow = {
  id: string;
  external_id: string | null;
  title: string | null;
  issuer: string | null;
  source_name: string | null;
  publish_date: string | null;
  status: string | null;
  confidence: number | null;
  metadata: JsonRecord | null;
};

type SupabasePolicyReportRow = SupabasePolicyRow & {
  effective_date: string | null;
  category: string | null;
  policy_level: string | null;
};

type SupabaseAnalysisJobRow = {
  id: string;
  title: string | null;
  source_url: string | null;
  source_name: string | null;
  status: string | null;
  progress: number | null;
  created_at: string | null;
  current_step: string | null;
};

type CreateAnalysisJobFunctionResponse = {
  job?: SupabaseAnalysisJobRow;
};

const FALLBACK_ISSUER = "未知机构";
const FALLBACK_SOURCE = "未知来源";
const FALLBACK_POLICY_TITLE = "未命名政策";
const FALLBACK_SOURCE_NAME = "手动提交";
const QUEUED_STEP = "已创建后台解析任务，等待抓取政策正文";

const reportStatuses: readonly ReportStatus[] = [
  "published",
  "processing",
  "draft",
  "failed",
  "reviewing",
  "archived"
];

const jobStatuses: readonly JobStatus[] = [
  "queued",
  "fetching",
  "extracting",
  "analyzing",
  "published",
  "failed"
];

const POLICY_REPORT_SELECT =
  "id,external_id,title,issuer,source_name,publish_date,effective_date,status,confidence,category,policy_level,metadata";

const METADATA_COUNT_CONTAINERS = [
  "counts",
  "reportCounts",
  "report_counts",
  "summary",
  "stats",
  "reportStats",
  "report_stats"
];

export class ReportRepositoryError extends Error {
  public readonly operation: RepositoryOperation;
  public readonly cause?: unknown;

  constructor(operation: RepositoryOperation, message: string, cause?: unknown) {
    super(message);
    this.name = "ReportRepositoryError";
    this.operation = operation;
    this.cause = cause;
  }
}

const currentReport: PolicyReport = {
  id: "data-elements-2024",
  summary: {
    id: "data-elements-2024",
    title: policy.title,
    issuer: policy.issuer,
    source: policy.source,
    publishDate: policy.publishDate,
    status: "published",
    confidence: policy.confidence,
    industryCount: chainNodes.length,
    companyCount: companies.length,
    evidenceCount: evidence.length,
    primarySignal: "数据流通与交易平台"
  },
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
  modules,
  topTabs
};

const mockSummaries: PolicySummary[] = [
  currentReport.summary,
  {
    id: "industrial-internet-2026",
    title: "推动工业互联网平台高质量发展行动方案（2026—2028年）",
    issuer: "工业和信息化部",
    source: "中国政府网",
    publishDate: "2026-01-13",
    status: "published",
    confidence: 84,
    industryCount: 17,
    companyCount: 21,
    evidenceCount: 9,
    primarySignal: "工业互联网平台"
  },
  {
    id: "ai-plus-manufacturing",
    title: "关于组织开展人工智能赋能新型工业化专项行动的通知",
    issuer: "工业和信息化部",
    source: "工信部官网",
    publishDate: "2025-12-02",
    status: "processing",
    confidence: 62,
    industryCount: 9,
    companyCount: 0,
    evidenceCount: 4,
    primarySignal: "工业模型与智能体"
  }
];

const mockJobs: AnalysisJob[] = [
  {
    id: "job-20240528-001",
    title: policy.title,
    sourceUrl: "https://www.gov.cn/example/data-elements-policy",
    sourceName: policy.source,
    status: "published",
    progress: 100,
    createdAt: "2024-05-28 10:24",
    currentStep: "已生成分析报表"
  },
  {
    id: "job-20260113-002",
    title: "推动工业互联网平台高质量发展行动方案（2026—2028年）",
    sourceUrl: "https://www.gov.cn/zhengce/zhengceku/202601/content_7054660.htm",
    sourceName: "中国政府网",
    status: "analyzing",
    progress: 72,
    createdAt: "2026-01-13 09:16",
    currentStep: "正在生成产业链影响图"
  }
];

const mockReportRepository: ReportRepository = {
  async listPolicyReports() {
    return mockSummaries;
  },

  async getPolicyReport() {
    return currentReport;
  },

  async listAnalysisJobs() {
    return mockJobs;
  },

  async createAnalysisJob(input) {
    const nextJob: AnalysisJob = {
      id: `job-${Date.now()}`,
      title: normalizeTitle(input.title),
      sourceUrl: input.sourceUrl,
      sourceName: input.sourceName ?? inferSourceName(input.sourceUrl),
      status: "queued",
      progress: 8,
      createdAt: formatLocalTimestamp(new Date()),
      currentStep: QUEUED_STEP
    };

    return nextJob;
  }
};

const supabaseReportRepository: ReportRepository = {
  async listPolicyReports() {
    const client = requireSupabaseClient("listPolicyReports");
    const { data, error } = await client
      .from("policies")
      .select("id,external_id,title,issuer,source_name,publish_date,status,confidence,metadata")
      .order("publish_date", { ascending: false });

    if (error) {
      throw createRepositoryError("listPolicyReports", error);
    }

    return (data ?? []).map((item) => mapPolicySummary(item as SupabasePolicyRow));
  },

  async getPolicyReport(reportId) {
    const row = await fetchPolicyReportRow(reportId);

    if (!row) {
      return getMockReportFallbackOrThrow(
        reportId,
        isLikelyUuid(reportId)
          ? `Report "${reportId}" was not found in Supabase.`
          : `Report "${reportId}" was not found in Supabase policies.external_id.`
      );
    }

    const metadata = isJsonRecord(row.metadata) ? row.metadata : {};
    const reportPayload = extractPolicyReportPayload(metadata);

    if (reportPayload) {
      return mapPolicyReportPayloadForApp(reportPayload, {
        id: row.external_id ?? row.id,
        title: row.title,
        issuer: row.issuer,
        sourceName: row.source_name,
        publishDate: row.publish_date,
        effectiveDate: row.effective_date,
        status: row.status,
        confidence: toNumberOrUndefined(row.confidence),
        category: row.category,
        policyLevel: row.policy_level,
        summary: mapPolicySummaryContext(row)
      }) as PolicyReport;
    }

    return getMockReportFallbackOrThrow(
      reportId,
      `Report "${reportId}" was found in Supabase, but policies.metadata does not contain a full report payload. Expected metadata.reportPayload, metadata.report_payload, metadata.policyReport, metadata.policy_report, metadata.report, or a nested payload equivalent.`
    );
  },

  async listAnalysisJobs() {
    const client = requireSupabaseClient("listAnalysisJobs");
    const { data, error } = await client
      .from("analysis_jobs")
      .select("id,title,source_url,source_name,status,progress,created_at,current_step")
      .order("created_at", { ascending: false });

    if (error) {
      throw createRepositoryError("listAnalysisJobs", error);
    }

    return (data ?? []).map((item) => mapAnalysisJob(item as SupabaseAnalysisJobRow));
  },

  async createAnalysisJob(input) {
    if (shouldUseIngestFunction()) {
      return createAnalysisJobViaIngestFunction(input);
    }

    const client = requireSupabaseClient("createAnalysisJob");
    const normalized = normalizeCreateJobInput(input);
    const { data, error } = await client
      .from("analysis_jobs")
      .insert({
        title: normalized.title,
        source_url: normalized.sourceUrl,
        source_name: normalized.sourceName,
        status: "queued",
        progress: 8,
        current_step: QUEUED_STEP,
        input_payload: normalized.inputPayload
      })
      .select("id,title,source_url,source_name,status,progress,created_at,current_step")
      .single();

    if (error) {
      throw createRepositoryError("createAnalysisJob", error);
    }

    if (!data) {
      throw new ReportRepositoryError("createAnalysisJob", "Supabase did not return the created job.");
    }

    return mapAnalysisJob(data as SupabaseAnalysisJobRow);
  }
};

export const reportRepository: ReportRepository =
  isSupabaseConfigured && supabase ? supabaseReportRepository : mockReportRepository;

export function getReportRepositoryMode(): "mock" | "supabase" {
  return reportRepository === supabaseReportRepository ? "supabase" : "mock";
}

export async function listPolicyReports(): Promise<PolicySummary[]> {
  return reportRepository.listPolicyReports();
}

export async function getPolicyReport(reportId: string): Promise<PolicyReport> {
  return reportRepository.getPolicyReport(reportId);
}

export async function listAnalysisJobs(): Promise<AnalysisJob[]> {
  return reportRepository.listAnalysisJobs();
}

export async function createAnalysisJob(input: CreateAnalysisJobInput): Promise<AnalysisJob> {
  return reportRepository.createAnalysisJob(input);
}

// Backward-compatible name used by App.tsx. In Supabase mode this creates a real queued job.
export async function createMockAnalysisJob(sourceUrl: string, title: string): Promise<AnalysisJob> {
  return createAnalysisJob({ sourceUrl, title });
}

async function createAnalysisJobViaIngestFunction(input: CreateAnalysisJobInput): Promise<AnalysisJob> {
  const client = requireSupabaseClient("invokeIngestFunction");
  const { data, error } = await client.functions.invoke<CreateAnalysisJobFunctionResponse>("ingest", {
    body: normalizeCreateJobInput(input)
  });

  if (error) {
    throw createRepositoryError("invokeIngestFunction", error);
  }

  if (!data?.job) {
    throw new ReportRepositoryError("invokeIngestFunction", "Edge Function did not return a job payload.");
  }

  return mapAnalysisJob(data.job);
}

function shouldUseIngestFunction(): boolean {
  return import.meta.env.VITE_ANALYSIS_JOB_MODE === "edge-function";
}

function requireSupabaseClient(operation: RepositoryOperation) {
  if (!supabase) {
    throw new ReportRepositoryError(operation, "Supabase is not configured.");
  }

  return supabase;
}

function normalizeCreateJobInput(input: CreateAnalysisJobInput) {
  const title = normalizeTitle(input.title);
  const sourceName = input.sourceName ?? inferSourceName(input.sourceUrl);

  return {
    title,
    sourceUrl: input.sourceUrl,
    sourceName,
    inputPayload: {
      sourceUrl: input.sourceUrl,
      title,
      sourceName,
      ...(input.sourceKey ? { sourceKey: input.sourceKey, source_key: input.sourceKey } : {}),
      ...(input.issuer ? { issuer: input.issuer } : {}),
      ...(input.publishDate ? { publishDate: input.publishDate, publish_date: input.publishDate } : {}),
      ...(input.policyNo ? { policyNo: input.policyNo, policy_no: input.policyNo } : {}),
      ...(input.canonicalSourceUrl ? { canonicalSourceUrl: input.canonicalSourceUrl, canonical_source_url: input.canonicalSourceUrl } : {}),
      ...(input.contentHash ? { contentHash: input.contentHash, content_hash: input.contentHash } : {}),
      ...(input.externalId ? { externalId: input.externalId, external_id: input.externalId } : {}),
      submittedAt: new Date().toISOString(),
      ...(input.inputPayload ?? {})
    }
  };
}

function normalizeTitle(title: string): string {
  return title.trim() || FALLBACK_POLICY_TITLE;
}

function inferSourceName(sourceUrl: string): string {
  if (!sourceUrl) {
    return FALLBACK_SOURCE_NAME;
  }

  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return FALLBACK_SOURCE_NAME;
  }
}

async function fetchPolicyReportRow(reportId: string): Promise<SupabasePolicyReportRow | null> {
  const client = requireSupabaseClient("getPolicyReport");
  const column = isLikelyUuid(reportId) ? "id" : "external_id";
  const { data, error } = await client
    .from("policies")
    .select(POLICY_REPORT_SELECT)
    .eq(column, reportId)
    .maybeSingle();

  if (error) {
    throw createRepositoryError("getPolicyReport", error);
  }

  return data ? data as SupabasePolicyReportRow : null;
}

function getMockReportFallbackOrThrow(reportId: string, message: string): PolicyReport {
  if (reportId === currentReport.id) {
    return currentReport;
  }

  throw new ReportRepositoryError("getPolicyReport", `${message} Only "${currentReport.id}" can fall back to the local mock report.`);
}

function mapPolicySummary(row: SupabasePolicyRow): PolicySummary {
  const metadata = isJsonRecord(row.metadata) ? row.metadata : {};
  const counts = mapPolicySummaryCounts(metadata);

  return {
    id: row.external_id ?? row.id,
    title: row.title ?? FALLBACK_POLICY_TITLE,
    issuer: row.issuer ?? FALLBACK_ISSUER,
    source: row.source_name ?? FALLBACK_SOURCE,
    publishDate: row.publish_date ?? "",
    status: coerceReportStatus(row.status),
    confidence: toNumber(row.confidence),
    industryCount: counts.industryCount ?? 0,
    companyCount: counts.companyCount ?? 0,
    evidenceCount: counts.evidenceCount ?? 0,
    primarySignal: counts.primarySignal ?? "待生成"
  };
}

function mapPolicySummaryContext(row: SupabasePolicyReportRow): Partial<PolicySummary> {
  const metadata = isJsonRecord(row.metadata) ? row.metadata : {};
  const counts = mapPolicySummaryCounts(metadata);
  const confidence = toNumberOrUndefined(row.confidence);
  const summary: Partial<PolicySummary> = {
    id: row.external_id ?? row.id,
    title: row.title ?? FALLBACK_POLICY_TITLE,
    issuer: row.issuer ?? FALLBACK_ISSUER,
    source: row.source_name ?? FALLBACK_SOURCE,
    publishDate: row.publish_date ?? "",
    status: coerceReportStatus(row.status),
    ...counts
  };

  if (confidence !== undefined) {
    summary.confidence = confidence;
  }

  return summary;
}

function mapAnalysisJob(row: SupabaseAnalysisJobRow): AnalysisJob {
  return {
    id: row.id,
    title: row.title ?? FALLBACK_POLICY_TITLE,
    sourceUrl: row.source_url ?? "",
    sourceName: row.source_name ?? FALLBACK_SOURCE_NAME,
    status: coerceJobStatus(row.status),
    progress: toNumber(row.progress),
    createdAt: row.created_at ?? "",
    currentStep: row.current_step ?? QUEUED_STEP
  };
}

function coerceReportStatus(status: string | null | undefined): ReportStatus {
  return reportStatuses.includes(status as ReportStatus) ? (status as ReportStatus) : "draft";
}

function coerceJobStatus(status: string | null | undefined): JobStatus {
  return jobStatuses.includes(status as JobStatus) ? (status as JobStatus) : "queued";
}

function mapPolicySummaryCounts(metadata: JsonRecord): Partial<Pick<
  PolicySummary,
  "industryCount" | "companyCount" | "evidenceCount" | "primarySignal"
>> {
  const counts: Partial<Pick<
    PolicySummary,
    "industryCount" | "companyCount" | "evidenceCount" | "primarySignal"
  >> = {};
  const industryCount = getMetadataNumber(metadata, "industryCount", "industry_count", "chainNodeCount", "chain_node_count");
  const companyCount = getMetadataNumber(metadata, "companyCount", "company_count");
  const evidenceCount = getMetadataNumber(metadata, "evidenceCount", "evidence_count");
  const primarySignal = getMetadataString(metadata, "primarySignal", "primary_signal");

  if (industryCount !== undefined) counts.industryCount = industryCount;
  if (companyCount !== undefined) counts.companyCount = companyCount;
  if (evidenceCount !== undefined) counts.evidenceCount = evidenceCount;
  if (primarySignal) counts.primarySignal = primarySignal;

  return counts;
}

function getMetadataNumber(metadata: JsonRecord, ...keys: string[]): number | undefined {
  return toNumberOrUndefined(getMetadataValue(metadata, keys));
}

function getMetadataString(metadata: JsonRecord, ...keys: string[]): string | undefined {
  return toStringValue(getMetadataValue(metadata, keys), "") || undefined;
}

function getMetadataValue(metadata: JsonRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (metadata[key] !== undefined) return metadata[key];
  }

  for (const containerKey of METADATA_COUNT_CONTAINERS) {
    const container = metadata[containerKey];
    if (!isJsonRecord(container)) continue;

    for (const key of keys) {
      if (container[key] !== undefined) return container[key];
    }
  }

  return undefined;
}

function toNumber(value: unknown): number {
  return toNumberOrUndefined(value) ?? 0;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatLocalTimestamp(date: Date): string {
  return date.toLocaleString("zh-CN", { hour12: false });
}

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function createRepositoryError(operation: RepositoryOperation, cause: unknown): ReportRepositoryError {
  return new ReportRepositoryError(operation, getErrorMessage(cause), cause);
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return String(error);
}
