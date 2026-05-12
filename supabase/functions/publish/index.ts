import {
  errorResponse,
  handleOptions,
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

const POLICY_MIN_PUBLISH_DATE = "2026-05-01";
const MANUAL_ANALYSIS_VERSION = "codex-manual-v1";

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

    if (!job.policy_id) {
      return jsonResponse({
        error: "Analysis job has no policy_id. Create jobs through ingest before publishing."
      }, 409);
    }

    const now = new Date().toISOString();
    const existingOutput = isRecord(job.output_payload) ? job.output_payload : {};
    const analysisStub = isRecord(existingOutput.analysisStub) ? existingOutput.analysisStub : null;
    const hasAnalysisStub = analysisStub !== null;
    const analysisMethod = readString(analysisStub, "analysisMethod") ?? readString(analysisStub, "analysis_method");
    const analyzerVersion = readString(analysisStub, "analyzerVersion") ?? readString(analysisStub, "analyzer_version");
    const hasManualAnalysis = analysisMethod === MANUAL_ANALYSIS_VERSION || analyzerVersion === MANUAL_ANALYSIS_VERSION;

    const { data: currentPolicy, error: currentPolicyError } = await supabase
      .from("policies")
      .select("id,title,status,publish_date,analysis_version")
      .eq("id", job.policy_id)
      .single();

    if (currentPolicyError || !currentPolicy) {
      throw currentPolicyError ?? new Error("Linked policy lookup returned no row.");
    }

    if (!currentPolicy.publish_date || currentPolicy.publish_date < POLICY_MIN_PUBLISH_DATE) {
      return jsonResponse({
        error: `Only policies published on or after ${POLICY_MIN_PUBLISH_DATE} can be published to the public terminal.`
      }, 409);
    }

    if (currentPolicy.analysis_version !== MANUAL_ANALYSIS_VERSION) {
      return jsonResponse({
        error: "Standalone publish is disabled until applyManualAnalysis has written a Codex manual report to the policy."
      }, 409);
    }

    if (job.status === "failed") {
      return jsonResponse({ error: "Analysis job is failed and cannot be published." }, 409);
    }

    if (job.status !== "published" && !hasAnalysisStub) {
      return jsonResponse({
        error: "Run analyze before publish. The job must contain analysis output before publishing."
      }, 409);
    }

    if (job.status !== "published" && !hasManualAnalysis) {
      return jsonResponse({
        error: "Only Codex manual analysis output can be published. Use applyManualAnalysis instead of rules analysis."
      }, 409);
    }

    const { data: policy, error: policyError } = await supabase
      .from("policies")
      .update({
        status: "published",
        published_at: now,
        analysis_version: MANUAL_ANALYSIS_VERSION
      })
      .eq("id", job.policy_id)
      .select("id,title,status,published_at,analysis_version")
      .single();

    if (policyError || !policy) {
      throw policyError ?? new Error("Policy publish update returned no row.");
    }

    const { data: updatedJob, error: jobError } = await supabase
      .from("analysis_jobs")
      .update({
        status: "published",
        progress: 100,
        current_step: "Policy report published",
        finished_at: now,
        output_payload: {
          ...existingOutput,
          publishedAt: now,
          publishedPolicyId: job.policy_id
        },
        error_message: null
      })
      .eq("id", job.id)
      .select("id,policy_id,title,source_url,source_name,status,progress,created_at,current_step")
      .single();

    if (jobError || !updatedJob) {
      throw jobError ?? new Error("Analysis job publish update returned no row.");
    }

    return jsonResponse({
      policy,
      job: updatedJob
    });
  } catch (error) {
    return errorResponse(error);
  }
});

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
