import {
  errorResponse,
  handleOptions,
  HttpError,
  isRecord,
  jsonResponse,
  readJsonObject,
  requirePost
} from "../_shared/http.ts";
import {
  createSupabaseAdminClient,
  requireAuthenticatedUser
} from "../_shared/supabaseAdmin.ts";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type PolicyRow = {
  id: string;
  external_id: string | null;
  title: string;
  issuer: string | null;
  source_name: string | null;
  source_url: string | null;
  publish_date: string | null;
  status: string | null;
  analysis_version: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  published_at: string | null;
};

type QueueDisposition =
  | "pending_review"
  | "awaiting_evidence"
  | "selected_for_analysis"
  | "quick_archived"
  | "dismissed";

type QueuePolicy = {
  id: string;
  externalId: string | null;
  title: string;
  issuer: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  publishDate: string;
  status: string;
  analysisVersion: string | null;
  analysisDepth: string;
  manualReviewDisposition: QueueDisposition;
  createdAt: string | null;
  updatedAt: string | null;
  openAnalysisJobCount: number;
  staleOpenAnalysisJobCount: number;
};

const POLICY_MIN_PUBLISH_DATE = "2026-05-01";
const MANUAL_ANALYSIS_VERSION = "codex-manual-v1";
const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;
const PAGE_SIZE = 500;
const MAX_ROWS = 10_000;
const OPEN_JOB_STATUSES = ["queued", "fetching", "extracting", "analyzing"];
const ALLOWED_DISPOSITIONS: QueueDisposition[] = [
  "pending_review",
  "awaiting_evidence",
  "selected_for_analysis",
  "quick_archived",
  "dismissed"
];

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    requirePost(req);
    const supabase = createSupabaseAdminClient();
    await requireAuthenticatedUser(req, supabase);
    const body = await readJsonObject(req);
    const windowDays = clampInteger(body.windowDays ?? body.window_days, DEFAULT_WINDOW_DAYS, 1, 90);
    const limit = clampInteger(body.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const generatedAt = new Date();
    const windowStart = rollingWindowStart(generatedAt, windowDays);
    const recentCutoff = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const policies = await fetchPolicies(supabase);
    const queueCandidates = policies
      .map(toQueueCandidate)
      .filter((item): item is Omit<QueuePolicy, "openAnalysisJobCount" | "staleOpenAnalysisJobCount"> => Boolean(item));
    const openJobCounts = await fetchOpenJobCounts(
      supabase,
      queueCandidates.map((item) => item.id)
    );
    const queue = queueCandidates
      .map((item) => {
        const openAnalysisJobCount = openJobCounts.get(item.id) ?? 0;
        return {
          ...item,
          openAnalysisJobCount,
          staleOpenAnalysisJobCount:
            item.manualReviewDisposition === "selected_for_analysis" ? 0 : openAnalysisJobCount
        };
      })
      .sort(compareQueuePolicies);

    const current = queue.filter((item) => item.publishDate >= windowStart);
    const historical = queue.filter((item) => item.publishDate < windowStart);
    const publishedManual = policies.filter(isPublishedManualPolicy);
    const recentPolicyIds = new Set<string>();
    for (const item of queue) {
      if (isAtOrAfter(item.updatedAt, recentCutoff)) recentPolicyIds.add(item.id);
    }
    for (const item of publishedManual) {
      if (isAtOrAfter(item.updated_at ?? item.published_at, recentCutoff)) recentPolicyIds.add(item.id);
    }

    return jsonResponse({
      formatVersion: "policy-operations-overview-v1",
      generatedAt: generatedAt.toISOString(),
      sincePublishDate: POLICY_MIN_PUBLISH_DATE,
      windowDays,
      windowStart,
      total: queue.length,
      rows: queue.slice(0, limit).map(toSafeQueueRow),
      current: summarizeQueue(current),
      historical: summarizeQueue(historical),
      evidenceBlockers: {
        total: queue.filter((item) => item.manualReviewDisposition === "awaiting_evidence").length,
        current: current.filter((item) => item.manualReviewDisposition === "awaiting_evidence").length,
        historical: historical.filter((item) => item.manualReviewDisposition === "awaiting_evidence").length
      },
      recent24h: {
        total: recentPolicyIds.size,
        queueUpdates: queue.filter((item) => isAtOrAfter(item.updatedAt, recentCutoff)).length,
        publishedReportUpdates: publishedManual.filter((item) =>
          isAtOrAfter(item.updated_at ?? item.published_at, recentCutoff)
        ).length
      },
      reports: {
        total: publishedManual.length
      },
      coverage: {
        complete: true,
        scannedPolicies: policies.length,
        returnedQueueRows: Math.min(queue.length, limit),
        queueRowsTruncated: queue.length > limit
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
});

async function fetchPolicies(supabase: SupabaseAdminClient): Promise<PolicyRow[]> {
  const rows: PolicyRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("policies")
      .select("id,external_id,title,issuer,source_name,source_url,publish_date,status,analysis_version,metadata,created_at,updated_at,published_at")
      .gte("publish_date", POLICY_MIN_PUBLISH_DATE)
      .not("publish_date", "is", null)
      .is("duplicate_of_policy_id", null)
      .order("publish_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new HttpError(500, "Unable to read policy operations state.", error);
    const page = (data ?? []) as PolicyRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
  throw new HttpError(409, `Policy operations scan exceeded ${MAX_ROWS} rows.`);
}

async function fetchOpenJobCounts(
  supabase: SupabaseAdminClient,
  policyIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const uniqueIds = [...new Set(policyIds)];
  for (let index = 0; index < uniqueIds.length; index += 50) {
    const chunk = uniqueIds.slice(index, index + 50);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("analysis_jobs")
      .select("policy_id,status")
      .in("policy_id", chunk)
      .in("status", OPEN_JOB_STATUSES);
    if (error) throw new HttpError(500, "Unable to read open analysis job state.", error);
    for (const item of data ?? []) {
      const policyId = typeof item.policy_id === "string" ? item.policy_id : null;
      if (!policyId) continue;
      counts.set(policyId, (counts.get(policyId) ?? 0) + 1);
    }
  }
  return counts;
}

function toQueueCandidate(
  policy: PolicyRow
): Omit<QueuePolicy, "openAnalysisJobCount" | "staleOpenAnalysisJobCount"> | null {
  const metadata = isRecord(policy.metadata) ? policy.metadata : {};
  const analysis = isRecord(metadata.analysis) ? metadata.analysis : {};
  const reportPayload = isRecord(metadata.reportPayload)
    ? metadata.reportPayload
    : isRecord(metadata.policyReport)
      ? metadata.policyReport
      : {};
  const analysisVersion = policy.analysis_version ??
    readString(analysis, "analyzerVersion") ??
    readString(reportPayload, "analyzerVersion");
  const manualComplete = analysisVersion === MANUAL_ANALYSIS_VERSION ||
    readString(analysis, "analysisMethod") === MANUAL_ANALYSIS_VERSION ||
    readString(metadata, "manualReviewDisposition") === "analysis_complete" ||
    readString(metadata, "manual_review_disposition") === "analysis_complete";
  const analysisDepth = readString(metadata, "analysisDepth") ??
    readString(metadata, "analysis_depth") ??
    "L2";
  const explicitEligibility = readBoolean(metadata, "manualAnalysisEligible") ??
    readBoolean(metadata, "manual_analysis_eligible");
  const eligible = explicitEligibility ?? ["L2", "L3"].includes(analysisDepth);
  const queueSelected = readBoolean(metadata, "analysisQueueSelected") ??
    readBoolean(metadata, "analysis_queue_selected") ??
    false;
  const explicitDisposition = normalizeDisposition(
    readString(metadata, "manualReviewDisposition") ??
    readString(metadata, "manual_review_disposition")
  );
  const disposition = explicitDisposition ?? (queueSelected ? "selected_for_analysis" : "pending_review");

  if (
    manualComplete ||
    !eligible ||
    !["L2", "L3"].includes(analysisDepth) ||
    disposition === "quick_archived" ||
    disposition === "dismissed" ||
    !policy.publish_date
  ) {
    return null;
  }

  return {
    id: policy.id,
    externalId: policy.external_id,
    title: policy.title,
    issuer: policy.issuer,
    sourceName: policy.source_name,
    sourceUrl: policy.source_url,
    publishDate: policy.publish_date,
    status: policy.status ?? "draft",
    analysisVersion,
    analysisDepth,
    manualReviewDisposition: disposition,
    createdAt: policy.created_at,
    updatedAt: policy.updated_at
  };
}

function isPublishedManualPolicy(policy: PolicyRow): boolean {
  return policy.status === "published" && policy.analysis_version === MANUAL_ANALYSIS_VERSION;
}

function summarizeQueue(items: QueuePolicy[]) {
  return {
    total: items.length,
    pendingReview: items.filter((item) => item.manualReviewDisposition === "pending_review").length,
    awaitingEvidence: items.filter((item) => item.manualReviewDisposition === "awaiting_evidence").length,
    selectedForAnalysis: items.filter((item) => item.manualReviewDisposition === "selected_for_analysis").length,
    totalOpenAnalysisJobs: items.reduce((sum, item) => sum + item.openAnalysisJobCount, 0),
    staleOpenAnalysisJobs: items.reduce((sum, item) => sum + item.staleOpenAnalysisJobCount, 0)
  };
}

function toSafeQueueRow(item: QueuePolicy) {
  return {
    id: item.externalId ?? item.id,
    title: item.title,
    issuer: item.issuer,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    publishDate: item.publishDate,
    status: item.status,
    analysisVersion: item.analysisVersion,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    manualReviewDisposition: item.manualReviewDisposition,
    openAnalysisJobCount: item.openAnalysisJobCount
  };
}

function compareQueuePolicies(left: QueuePolicy, right: QueuePolicy): number {
  const rank: Record<QueueDisposition, number> = {
    selected_for_analysis: 0,
    pending_review: 1,
    awaiting_evidence: 2,
    quick_archived: 3,
    dismissed: 4
  };
  return rank[left.manualReviewDisposition] - rank[right.manualReviewDisposition] ||
    right.publishDate.localeCompare(left.publishDate) ||
    String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
}

function normalizeDisposition(value: string | null): QueueDisposition | null {
  return ALLOWED_DISPOSITIONS.includes(value as QueueDisposition) ? value as QueueDisposition : null;
}

function rollingWindowStart(now: Date, days: number): string {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - Math.max(0, days - 1));
  return date.toISOString().slice(0, 10);
}

function isAtOrAfter(value: string | null | undefined, cutoff: string): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && timestamp >= Date.parse(cutoff);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}
