import {
  errorResponse,
  handleOptions,
  isRecord,
  jsonResponse,
  optionalString,
  requirePost,
  readJsonObject,
  toJson
} from "../_shared/http.ts";
import type { TableInsert } from "../_shared/database.types.ts";
import {
  createSupabaseAdminClient,
  requireCrawlerOrAdminUser
} from "../_shared/supabaseAdmin.ts";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type PolicyInsertValues = TableInsert<"policies">;

type ExistingPolicyRecord = {
  id: string;
  external_id?: string | null;
  title?: string | null;
  status?: string | null;
  source_url?: string | null;
  source_name?: string | null;
  dedupe_key?: string | null;
  content_hash?: string | null;
  metadata?: unknown;
};

const POLICY_MIN_PUBLISH_DATE = "2026-05-01";
const MIN_POLICY_FULL_TEXT_LENGTH = 280;
const MAX_PENDING_POLICY_REVIEW_QUEUE = 8;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    requirePost(req);

    const supabase = createSupabaseAdminClient();
    const body = await readJsonObject(req);
    const user = await requireCrawlerOrAdminUser(req, supabase);

    if (body.preflight === true) {
      const { count, error } = await supabase
        .from("policy_sources")
        .select("id", { count: "exact", head: true })
        .eq("status", "active");

      if (error) {
        throw error;
      }

      return jsonResponse({
        ok: true,
        actor: user.source,
        crawlerOwnerId: user.id,
        activePolicySources: count ?? 0
      });
    }

    const sourceUrl = optionalString(body, "sourceUrl");
    const title = optionalString(body, "title") ?? "Untitled policy";
    const sourceName = optionalString(body, "sourceName") ?? inferSourceName(sourceUrl);
    const now = new Date().toISOString();
    const inputPayload = isRecord(body.inputPayload) ? body.inputPayload : {};
    const sourceKey =
      optionalString(body, "sourceKey") ??
      optionalString(body, "source_key") ??
      optionalString(inputPayload, "sourceKey") ??
      optionalString(inputPayload, "source_key");
    const sourceId = await resolvePolicySourceId(supabase, sourceKey, sourceUrl);
    const issuer = optionalString(body, "issuer") ?? optionalString(inputPayload, "issuer");
    const publishDate =
      optionalString(body, "publishDate") ??
      optionalString(body, "publish_date") ??
      optionalString(inputPayload, "publishDate") ??
      optionalString(inputPayload, "publish_date");
    const publishDateTime =
      optionalString(body, "publishDateTime") ??
      optionalString(body, "publish_date_time") ??
      optionalString(body, "officialPublishedAt") ??
      optionalString(body, "official_published_at") ??
      optionalString(body, "sourcePublishedAt") ??
      optionalString(body, "source_published_at") ??
      optionalString(inputPayload, "publishDateTime") ??
      optionalString(inputPayload, "publish_date_time") ??
      optionalString(inputPayload, "officialPublishedAt") ??
      optionalString(inputPayload, "official_published_at") ??
      optionalString(inputPayload, "sourcePublishedAt") ??
      optionalString(inputPayload, "source_published_at");
    const publishTimezone =
      optionalString(body, "publishTimezone") ??
      optionalString(body, "publish_timezone") ??
      optionalString(inputPayload, "publishTimezone") ??
      optionalString(inputPayload, "publish_timezone") ??
      (publishDateTime ? "Asia/Shanghai" : null);
    const policyNo =
      optionalString(body, "policyNo") ??
      optionalString(body, "policy_no") ??
      optionalString(inputPayload, "policyNo") ??
      optionalString(inputPayload, "policy_no");
    const fullText =
      optionalString(body, "fullText") ??
      optionalString(body, "full_text") ??
      optionalString(inputPayload, "fullText") ??
      optionalString(inputPayload, "full_text");
    const contentHash =
      optionalString(body, "contentHash") ??
      optionalString(body, "content_hash") ??
      optionalString(inputPayload, "contentHash") ??
      optionalString(inputPayload, "content_hash");
    const canonicalSourceUrl = normalizeUrl(
      optionalString(body, "canonicalSourceUrl") ??
        optionalString(body, "canonical_source_url") ??
        sourceUrl
    );
    const dedupeKey =
      optionalString(body, "dedupeKey") ??
      optionalString(body, "dedupe_key") ??
      optionalString(inputPayload, "dedupeKey") ??
      optionalString(inputPayload, "dedupe_key") ??
      buildDedupeKey({ title, issuer, publishDate, policyNo, canonicalSourceUrl });
    const externalId =
      optionalString(body, "externalId") ??
      optionalString(body, "external_id") ??
      optionalString(inputPayload, "externalId") ??
      optionalString(inputPayload, "external_id");
    const analysisDepth = normalizeAnalysisDepth(
      optionalString(body, "analysisDepth") ??
      optionalString(body, "analysis_depth") ??
      optionalString(inputPayload, "analysisDepth") ??
      optionalString(inputPayload, "analysis_depth")
    );
    const reviewPriority = normalizeReviewPriority(
      body.reviewPriority ?? body.review_priority ?? inputPayload.reviewPriority ?? inputPayload.review_priority
    );
    const triageReasons = normalizeStringList(
      body.triageReasons ?? body.triage_reasons ?? inputPayload.triageReasons ?? inputPayload.triage_reasons
    );
    const triageSignals = normalizeStringList(
      body.triageSignals ?? body.triage_signals ?? inputPayload.triageSignals ?? inputPayload.triage_signals
    );
    const explicitManualEligibility = normalizeOptionalBoolean(
      body.manualAnalysisEligible ?? body.manual_analysis_eligible ??
      inputPayload.manualAnalysisEligible ?? inputPayload.manual_analysis_eligible
    );
    const manualAnalysisEligible = explicitManualEligibility ??
      (analysisDepth ? analysisDepth === "L2" || analysisDepth === "L3" : true);
    const explicitPendingReview = normalizeOptionalBoolean(
      body.requiresManualAnalysis ?? body.requires_manual_analysis ??
      inputPayload.requiresManualAnalysis ?? inputPayload.requires_manual_analysis
    );
    let requiresManualAnalysis = explicitPendingReview ?? manualAnalysisEligible;
    const explicitQueueSelection = normalizeOptionalBoolean(
      body.analysisQueueSelected ?? body.analysis_queue_selected ??
      inputPayload.analysisQueueSelected ?? inputPayload.analysis_queue_selected
    );
    let analysisQueueSelected = explicitQueueSelection ?? requiresManualAnalysis;

    if (!sourceUrl && title === "Untitled policy") {
      return jsonResponse({ error: "Provide at least sourceUrl or title." }, 400);
    }

    if (!isAllowedPolicyPublishDate(publishDate)) {
      return jsonResponse({
        error: `Policy ingest is limited to original policies published on or after ${POLICY_MIN_PUBLISH_DATE}.`
      }, 409);
    }

    if (!hasUsablePolicyText(fullText)) {
      return jsonResponse({
        error: `Policy ingest requires original policy full_text with at least ${MIN_POLICY_FULL_TEXT_LENGTH} characters.`
      }, 409);
    }

    const existingPolicy = await findExistingPolicy(supabase, dedupeKey, contentHash);
    const queueDecision = await enforcePolicyReviewQueueCapacity(supabase, existingPolicy, {
      manualAnalysisEligible,
      requiresManualAnalysis,
      analysisQueueSelected
    });
    requiresManualAnalysis = queueDecision.requiresManualAnalysis;
    analysisQueueSelected = queueDecision.analysisQueueSelected;

    const policyValues = {
      owner_id: user.id,
      title,
      status: "draft" as const,
      source_id: sourceId,
      source_url: sourceUrl,
      source_name: sourceName,
      issuer,
      publish_date: publishDate,
      policy_no: policyNo,
      canonical_source_url: canonicalSourceUrl,
      dedupe_key: dedupeKey,
      content_hash: contentHash,
      full_text: fullText,
      metadata: toJson({
        ingestionStatus: "queued",
        ingestionRequestedAt: now,
        ingestVersion: "v0.3",
        fullTextLength: fullText?.length ?? 0,
        full_text_length: fullText?.length ?? 0,
        dedupeKey,
        dedupe_key: dedupeKey,
        contentHash,
        content_hash: contentHash,
        canonicalSourceUrl,
        canonical_source_url: canonicalSourceUrl,
        ...(publishDateTime
          ? {
              publishDateTime,
              publish_date_time: publishDateTime,
              officialPublishedAt: publishDateTime,
              official_published_at: publishDateTime,
              publishTimezone,
              publish_timezone: publishTimezone
            }
          : {}),
        ...(externalId
          ? {
              externalId,
              external_id: externalId
            }
          : {}),
        ...(analysisDepth
          ? {
              analysisDepth,
              analysis_depth: analysisDepth
            }
          : {}),
        reviewPriority,
        review_priority: reviewPriority,
        manualAnalysisEligible,
        manual_analysis_eligible: manualAnalysisEligible,
        requiresManualAnalysis,
        requires_manual_analysis: requiresManualAnalysis,
        analysisQueueSelected,
        analysis_queue_selected: analysisQueueSelected,
        queueDeferred: queueDecision.queueDeferred,
        queue_deferred: queueDecision.queueDeferred,
        triageReasons,
        triage_reasons: triageReasons,
        triageSignals,
        triage_signals: triageSignals
      }, "policy ingest metadata")
    };

    if (existingPolicy) {
      const mergedTriage = await mergeExistingPolicyTriage(supabase, existingPolicy, {
        analysisDepth,
        reviewPriority,
        manualAnalysisEligible,
        requiresManualAnalysis,
        analysisQueueSelected,
        triageReasons,
        triageSignals,
        queueDeferred: queueDecision.queueDeferred
      });
      const job = existingPolicy.status !== "published" && mergedTriage.analysisQueueSelected
        ? await createDuplicateLinkJob(supabase, {
            userId: user.id,
            existingPolicy,
            title,
            sourceUrl,
            sourceName,
            inputPayload: {
              ...inputPayload,
              analysisDepth: mergedTriage.analysisDepth,
              analysis_depth: mergedTriage.analysisDepth,
              reviewPriority: mergedTriage.reviewPriority,
              review_priority: mergedTriage.reviewPriority,
              manualAnalysisEligible: mergedTriage.manualAnalysisEligible,
              manual_analysis_eligible: mergedTriage.manualAnalysisEligible,
              requiresManualAnalysis: mergedTriage.requiresManualAnalysis,
              requires_manual_analysis: mergedTriage.requiresManualAnalysis,
              analysisQueueSelected: mergedTriage.analysisQueueSelected,
              analysis_queue_selected: mergedTriage.analysisQueueSelected,
              triageReasons: mergedTriage.triageReasons,
              triage_reasons: mergedTriage.triageReasons,
              triageSignals: mergedTriage.triageSignals,
              triage_signals: mergedTriage.triageSignals
            },
            now,
            dedupeKey,
            contentHash
          })
        : null;

      return jsonResponse({
        duplicate: true,
        policyId: existingPolicy.id,
        policyExternalId: getString(existingPolicy, "external_id") ?? externalId,
        policyRef: {
          id: existingPolicy.id,
          externalId: getString(existingPolicy, "external_id") ?? externalId,
          external_id: getString(existingPolicy, "external_id") ?? externalId,
          duplicate: true,
          dedupeKey,
          contentHash
        },
        policy: {
          ...existingPolicy,
          metadata: mergedTriage.metadata
        },
        triage: mergedTriage,
        job,
        next: job && isOpenAnalysisJob(job) ? ["analyze"] : []
      }, 200);
    }

    const { policy, externalIdColumnWritten } = await insertPolicy(
      supabase,
      policyValues,
      externalId
    );
    const policyId = getString(policy, "id");

    if (!policyId) {
      throw new Error("Policy insert returned no id.");
    }

    const policyExternalId = getString(policy, "external_id") ?? externalId;

    if (!analysisQueueSelected) {
      return jsonResponse({
        policyId,
        policyExternalId,
        policyRef: {
          id: policyId,
          externalId: policyExternalId,
          external_id: policyExternalId,
          externalIdColumnWritten
        },
        policy,
        job: null,
        next: [],
        archivedWithoutAnalysis: !manualAnalysisEligible,
        queuedForManualReview: requiresManualAnalysis,
        deferredManualAnalysis: manualAnalysisEligible && !requiresManualAnalysis,
        analysisDepth,
        reviewPriority
      }, 201);
    }

    const { data: job, error: jobError } = await supabase
      .from("analysis_jobs")
      .insert({
        policy_id: policyId,
        owner_id: user.id,
        title,
        source_url: sourceUrl,
        source_name: sourceName,
        status: "queued",
        progress: 8,
        current_step: "Queued for policy ingestion",
        input_payload: {
          ...inputPayload,
          sourceUrl,
          sourceName,
          sourceKey,
          source_key: sourceKey,
          sourceId,
          source_id: sourceId,
          title,
          issuer,
          publishDate,
          publish_date: publishDate,
          ...(publishDateTime
            ? {
                publishDateTime,
                publish_date_time: publishDateTime,
                officialPublishedAt: publishDateTime,
                official_published_at: publishDateTime,
                publishTimezone,
                publish_timezone: publishTimezone
              }
            : {}),
          policyNo,
          policy_no: policyNo,
          canonicalSourceUrl,
          canonical_source_url: canonicalSourceUrl,
          dedupeKey,
          dedupe_key: dedupeKey,
          contentHash,
          content_hash: contentHash,
          fullTextLength: fullText?.length ?? 0,
          full_text_length: fullText?.length ?? 0,
          policyId,
          policyExternalId,
          externalId: policyExternalId,
          external_id: policyExternalId,
          analysisDepth,
          analysis_depth: analysisDepth,
          reviewPriority,
          review_priority: reviewPriority,
          manualAnalysisEligible,
          manual_analysis_eligible: manualAnalysisEligible,
          requiresManualAnalysis,
          requires_manual_analysis: requiresManualAnalysis,
          analysisQueueSelected,
          analysis_queue_selected: analysisQueueSelected,
          triageReasons,
          triage_reasons: triageReasons,
          triageSignals,
          triage_signals: triageSignals,
          requestedBy: user.id,
          requestedAt: now
        }
      })
      .select("id,policy_id,title,source_url,source_name,status,progress,created_at,current_step")
      .single();

    if (jobError || !job) {
      throw jobError ?? new Error("Analysis job insert returned no row.");
    }

    return jsonResponse({
      policyId,
      policyExternalId,
      policyRef: {
        id: policyId,
        externalId: policyExternalId,
        external_id: policyExternalId,
        externalIdColumnWritten
      },
      policy,
      job,
      next: ["analyze"]
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
});

async function insertPolicy(
  supabase: SupabaseAdminClient,
  values: PolicyInsertValues,
  externalId: string | null
): Promise<{ policy: Record<string, unknown>; externalIdColumnWritten: boolean }> {
  const baseSelect = "id,title,status,source_url,source_name,dedupe_key,content_hash,created_at";

  if (!externalId) {
    const { data, error } = await supabase
      .from("policies")
      .insert(values)
      .select(baseSelect)
      .single();

    if (error || !data) {
      throw error ?? new Error("Policy insert returned no row.");
    }

    return { policy: data as Record<string, unknown>, externalIdColumnWritten: false };
  }

  const { data, error } = await supabase
    .from("policies")
    .insert({
      ...values,
      external_id: externalId
    })
    .select("id,external_id,title,status,source_url,source_name,dedupe_key,content_hash,created_at")
    .single();

  if (!error && data) {
    return { policy: data as Record<string, unknown>, externalIdColumnWritten: true };
  }

  if (!isMissingExternalIdColumnError(error)) {
    throw error ?? new Error("Policy insert returned no row.");
  }

  const { data: fallbackData, error: fallbackError } = await supabase
    .from("policies")
    .insert(values)
    .select(baseSelect)
    .single();

  if (fallbackError || !fallbackData) {
    throw fallbackError ?? new Error("Policy insert returned no row.");
  }

  return { policy: fallbackData as Record<string, unknown>, externalIdColumnWritten: false };
}

async function resolvePolicySourceId(
  supabase: SupabaseAdminClient,
  sourceKey: string | null,
  sourceUrl: string | null
): Promise<string | null> {
  if (sourceKey) {
    const { data, error } = await supabase
      .from("policy_sources")
      .select("id")
      .eq("source_key", sourceKey)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data?.id && typeof data.id === "string") {
      return data.id;
    }
  }

  if (!sourceUrl) {
    return null;
  }

  const { data, error } = await supabase
    .from("policy_sources")
    .select("id,homepage_url,list_url")
    .eq("status", "active");

  if (error) {
    throw error;
  }

  const normalizedInputUrl = normalizeUrl(sourceUrl);
  if (!normalizedInputUrl) {
    return null;
  }

  return findMatchingSourceId(
    (data ?? []) as Array<{ id: string; homepage_url: string | null; list_url: string | null }>,
    normalizedInputUrl
  );
}

function findMatchingSourceId(
  sources: Array<{ id: string; homepage_url: string | null; list_url: string | null }>,
  sourceUrl: string
): string | null {
  let input: URL;

  try {
    input = new URL(sourceUrl);
  } catch {
    return null;
  }

  for (const source of sources) {
    const listUrl = normalizeUrl(source.list_url);
    if (listUrl && sourceUrl.startsWith(listUrl)) {
      return source.id;
    }

    const homepageUrl = normalizeUrl(source.homepage_url);
    if (!homepageUrl) continue;

    try {
      const homepage = new URL(homepageUrl);
      if (homepage.hostname === input.hostname) {
        return source.id;
      }
    } catch {
      // Ignore malformed source registry URLs.
    }
  }

  return null;
}

async function findExistingPolicy(
  supabase: SupabaseAdminClient,
  dedupeKey: string | null,
  contentHash: string | null
): Promise<ExistingPolicyRecord | null> {
  const select = "id,external_id,title,status,source_url,source_name,dedupe_key,content_hash,metadata";

  if (dedupeKey) {
    const { data, error } = await supabase
      .from("policies")
      .select(select)
      .eq("dedupe_key", dedupeKey)
      .is("duplicate_of_policy_id", null)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return data as ExistingPolicyRecord;
    }
  }

  if (contentHash) {
    const { data, error } = await supabase
      .from("policies")
      .select(select)
      .eq("content_hash", contentHash)
      .is("duplicate_of_policy_id", null)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return data as ExistingPolicyRecord;
    }
  }

  return null;
}

type QueueCapacityDecision = {
  requiresManualAnalysis: boolean;
  analysisQueueSelected: boolean;
  queueDeferred: boolean;
};

async function enforcePolicyReviewQueueCapacity(
  supabase: SupabaseAdminClient,
  existingPolicy: ExistingPolicyRecord | null,
  requested: {
    manualAnalysisEligible: boolean;
    requiresManualAnalysis: boolean;
    analysisQueueSelected: boolean;
  }
): Promise<QueueCapacityDecision> {
  if (!requested.manualAnalysisEligible || !requested.requiresManualAnalysis) {
    return {
      requiresManualAnalysis: false,
      analysisQueueSelected: false,
      queueDeferred: requested.manualAnalysisEligible
    };
  }

  const existingMetadata = existingPolicy && isRecord(existingPolicy.metadata)
    ? existingPolicy.metadata
    : {};
  const existingRequiresManualAnalysis = normalizeOptionalBoolean(
    existingMetadata.requiresManualAnalysis ?? existingMetadata.requires_manual_analysis
  );
  const existingDepth = normalizeAnalysisDepth(
    getMetadataString(existingMetadata, "analysisDepth", "analysis_depth")
  );
  const legacyOrImplicitPending = Boolean(
    existingPolicy &&
    existingPolicy.status !== "published" &&
    existingPolicy.status !== "archived" &&
    existingRequiresManualAnalysis === null &&
    (existingDepth === null || existingDepth === "L2" || existingDepth === "L3")
  );
  const alreadyPending = Boolean(
    existingRequiresManualAnalysis ||
    normalizeOptionalBoolean(
      existingMetadata.analysisQueueSelected ?? existingMetadata.analysis_queue_selected
    ) ||
    legacyOrImplicitPending
  );

  if (alreadyPending) {
    return {
      requiresManualAnalysis: true,
      analysisQueueSelected: requested.analysisQueueSelected,
      queueDeferred: false
    };
  }

  const { data, error } = await supabase.rpc("list_pending_policy_analysis", {
    limit_count: MAX_PENDING_POLICY_REVIEW_QUEUE
  });

  if (error) {
    throw error;
  }

  const total = isRecord(data) && typeof data.total === "number"
    ? data.total
    : Number.NaN;
  if (!Number.isFinite(total) || total < 0) {
    throw new Error("Pending policy review queue returned an invalid total.");
  }

  if (total >= MAX_PENDING_POLICY_REVIEW_QUEUE) {
    return {
      requiresManualAnalysis: false,
      analysisQueueSelected: false,
      queueDeferred: true
    };
  }

  return {
    requiresManualAnalysis: true,
    analysisQueueSelected: requested.analysisQueueSelected,
    queueDeferred: false
  };
}

type TriageState = {
  analysisDepth: "L0" | "L1" | "L2" | "L3" | null;
  reviewPriority: number;
  manualAnalysisEligible: boolean;
  requiresManualAnalysis: boolean;
  analysisQueueSelected: boolean;
  triageReasons: string[];
  triageSignals: string[];
  queueDeferred: boolean;
  metadata: Record<string, unknown>;
};

async function mergeExistingPolicyTriage(
  supabase: SupabaseAdminClient,
  existingPolicy: ExistingPolicyRecord,
  incoming: Omit<TriageState, "metadata">
): Promise<TriageState> {
  const existingMetadata = isRecord(existingPolicy.metadata) ? existingPolicy.metadata : {};
  const existingDepth = normalizeAnalysisDepth(
    getMetadataString(existingMetadata, "analysisDepth", "analysis_depth")
  );
  const analysisDepth = pickStrongerAnalysisDepth(existingDepth, incoming.analysisDepth);
  const reviewPriority = Math.max(
    normalizeReviewPriority(existingMetadata.reviewPriority ?? existingMetadata.review_priority),
    incoming.reviewPriority
  );
  const manualAnalysisEligible = Boolean(
    normalizeOptionalBoolean(
      existingMetadata.manualAnalysisEligible ?? existingMetadata.manual_analysis_eligible
    ) || incoming.manualAnalysisEligible
  );
  const analysisQueueSelected = Boolean(
    normalizeOptionalBoolean(
      existingMetadata.analysisQueueSelected ?? existingMetadata.analysis_queue_selected
    ) || incoming.analysisQueueSelected
  );
  const requiresManualAnalysis = Boolean(
    normalizeOptionalBoolean(
      existingMetadata.requiresManualAnalysis ?? existingMetadata.requires_manual_analysis
    ) || incoming.requiresManualAnalysis || analysisQueueSelected
  );
  const queueDeferred = manualAnalysisEligible && !requiresManualAnalysis;
  const triageReasons = mergeStringLists(
    existingMetadata.triageReasons ?? existingMetadata.triage_reasons,
    incoming.triageReasons
  );
  const triageSignals = mergeStringLists(
    existingMetadata.triageSignals ?? existingMetadata.triage_signals,
    incoming.triageSignals
  );
  const metadata = {
    ...existingMetadata,
    ...(analysisDepth ? { analysisDepth, analysis_depth: analysisDepth } : {}),
    reviewPriority,
    review_priority: reviewPriority,
    manualAnalysisEligible,
    manual_analysis_eligible: manualAnalysisEligible,
    requiresManualAnalysis,
    requires_manual_analysis: requiresManualAnalysis,
    analysisQueueSelected,
    analysis_queue_selected: analysisQueueSelected,
    queueDeferred,
    queue_deferred: queueDeferred,
    triageReasons,
    triage_reasons: triageReasons,
    triageSignals,
    triage_signals: triageSignals
  };

  if (!sameJson(existingMetadata, metadata)) {
    const { error } = await supabase
      .from("policies")
      .update({ metadata: toJson(metadata, "merged policy triage metadata") })
      .eq("id", existingPolicy.id);

    if (error) {
      throw error;
    }
  }

  return {
    analysisDepth,
    reviewPriority,
    manualAnalysisEligible,
    requiresManualAnalysis,
    analysisQueueSelected,
    triageReasons,
    triageSignals,
    queueDeferred,
    metadata
  };
}

async function createDuplicateLinkJob(
  supabase: SupabaseAdminClient,
  input: {
    userId: string;
    existingPolicy: ExistingPolicyRecord;
    title: string;
    sourceUrl: string | null;
    sourceName: string;
    inputPayload: Record<string, unknown>;
    now: string;
    dedupeKey: string | null;
    contentHash: string | null;
  }
): Promise<Record<string, unknown>> {
  const { data: existingJob, error: existingJobError } = await supabase
    .from("analysis_jobs")
    .select("id,policy_id,title,source_url,source_name,status,progress,created_at,current_step")
    .eq("policy_id", input.existingPolicy.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingJobError) {
    throw existingJobError;
  }

  if (existingJob) {
    return {
      ...(existingJob as Record<string, unknown>),
      idempotentReplay: true
    };
  }

  const { data, error } = await supabase
    .from("analysis_jobs")
    .insert({
      policy_id: input.existingPolicy.id,
      owner_id: input.userId,
      title: input.title,
      source_url: input.sourceUrl,
      source_name: input.sourceName,
      status: "queued",
      progress: 12,
      current_step: "Duplicate source detected; linked to existing policy",
      input_payload: {
        ...input.inputPayload,
        duplicate: true,
        duplicateOfPolicyId: input.existingPolicy.id,
        duplicate_of_policy_id: input.existingPolicy.id,
        sourceUrl: input.sourceUrl,
        sourceName: input.sourceName,
        title: input.title,
        dedupeKey: input.dedupeKey,
        dedupe_key: input.dedupeKey,
        contentHash: input.contentHash,
        content_hash: input.contentHash,
        requestedBy: input.userId,
        requestedAt: input.now
      }
    })
    .select("id,policy_id,title,source_url,source_name,status,progress,created_at,current_step")
    .single();

  if (error || !data) {
    throw error ?? new Error("Duplicate link job insert returned no row.");
  }

  return data as Record<string, unknown>;
}

function isOpenAnalysisJob(job: Record<string, unknown>): boolean {
  return job.status === "queued" || job.status === "fetching" || job.status === "extracting" || job.status === "analyzing";
}

function getMetadataString(metadata: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickStrongerAnalysisDepth(
  existing: "L0" | "L1" | "L2" | "L3" | null,
  incoming: "L0" | "L1" | "L2" | "L3" | null
): "L0" | "L1" | "L2" | "L3" | null {
  const rank = { L0: 0, L1: 1, L2: 2, L3: 3 } as const;
  if (!existing) return incoming;
  if (!incoming) return existing;
  return rank[incoming] > rank[existing] ? incoming : existing;
}

function mergeStringLists(existing: unknown, incoming: unknown): string[] {
  return normalizeStringList([
    ...normalizeStringList(existing),
    ...normalizeStringList(incoming)
  ]);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isMissingExternalIdColumnError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const code = typeof error.code === "string" ? error.code : "";
  const details = [error.message, error.details, error.hint]
    .filter((item): item is string => typeof item === "string")
    .join(" ");

  return code === "PGRST204" && details.includes("external_id");
}

function getString(record: object, key: string): string | null {
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeAnalysisDepth(value: string | null): "L0" | "L1" | "L2" | "L3" | null {
  return value === "L0" || value === "L1" || value === "L2" || value === "L3" ? value : null;
}

function normalizeReviewPriority(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeStringList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return Array.from(new Set(
    items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
  )).slice(0, 12);
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return null;
}

function isAllowedPolicyPublishDate(value: string | null): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= POLICY_MIN_PUBLISH_DATE;
}

function hasUsablePolicyText(value: string | null): boolean {
  return typeof value === "string" && value.trim().length >= MIN_POLICY_FULL_TEXT_LENGTH;
}

function buildDedupeKey(input: {
  title: string;
  issuer: string | null;
  publishDate: string | null;
  policyNo: string | null;
  canonicalSourceUrl: string | null;
}): string | null {
  const normalizedPolicyNo = normalizeText(input.policyNo);
  const normalizedIssuer = normalizeText(input.issuer);
  const normalizedTitle = normalizeText(input.title);

  if (normalizedPolicyNo) {
    return `policy-no:${normalizedIssuer || "unknown"}:${normalizedPolicyNo}`;
  }

  if (normalizedTitle && input.publishDate) {
    return `title-date:${normalizedIssuer || "unknown"}:${input.publishDate}:${normalizedTitle}`;
  }

  return input.canonicalSourceUrl ? `url:${input.canonicalSourceUrl}` : null;
}

function normalizeText(value: string | null): string | null {
  if (!value) return null;

  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[《》“”"'\[\]【】()（）,，.。;；:：\-_—\s\u3000]/g, "");

  return normalized || null;
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|spm|from|source|share)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.trim() || null;
  }
}

function inferSourceName(sourceUrl: string | null): string {
  if (!sourceUrl) {
    return "Manual submission";
  }

  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return "Manual submission";
  }
}
