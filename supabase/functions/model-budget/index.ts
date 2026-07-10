import {
  errorResponse,
  handleOptions,
  HttpError,
  isRecord,
  jsonResponse,
  optionalString,
  readJsonObject,
  requirePost,
  requireString,
  toJson
} from "../_shared/http.ts";
import type { Stage8Database } from "../_shared/database.stage8.types.ts";
import { mapRpcError } from "../_shared/rpcError.ts";
import {
  createSupabaseAdminClient,
  requireActiveAdminUser
} from "../_shared/supabaseAdmin.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const BUDGET_CLASSES = new Set(["L0", "L1", "L2", "L3", "exception"]);

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    requirePost(req);
    const body = await readJsonObject(req);
    const action = requireString(body, "action");
    const authClient = createSupabaseAdminClient();
    const actor = await requireActiveAdminUser(req, authClient);
    const rpcClient = createSupabaseAdminClient<Stage8Database>();

    if (action === "reserve") {
      const result = await reserveUsage(body, actor.id, rpcClient);
      return jsonResponse({ action, actorId: actor.id, result });
    }
    if (action === "finalize") {
      const result = await finalizeUsage(body, actor.id, rpcClient);
      return jsonResponse({ action, actorId: actor.id, result });
    }
    throw new HttpError(400, "action must be reserve or finalize.");
  } catch (error) {
    return errorResponse(error);
  }
});

async function reserveUsage(
  body: Record<string, unknown>,
  actorId: string,
  rpcClient: ReturnType<typeof createSupabaseAdminClient<Stage8Database>>
) {
  const policyId = optionalUuid(body.policyId ?? body.policy_id, "policyId");
  const revisionId = optionalUuid(body.revisionId ?? body.revision_id, "revisionId");
  if (revisionId && !policyId) {
    throw new HttpError(400, "revisionId requires policyId.");
  }

  const operationType = requireStringAlias(body, "operationType", "operation_type");
  const provider = optionalString(body, "provider");
  const model = requireString(body, "model");
  const promptVersion = optionalString(body, "promptVersion") ?? optionalString(body, "prompt_version");
  const requestHash = requireStringAlias(body, "requestHash", "request_hash").toLowerCase();
  if (!SHA256_PATTERN.test(requestHash)) {
    throw new HttpError(400, "requestHash must be a SHA-256 hexadecimal string.");
  }
  const budgetClass = requireStringAlias(body, "budgetClass", "budget_class");
  if (!BUDGET_CLASSES.has(budgetClass)) {
    throw new HttpError(400, "budgetClass must be L0, L1, L2, L3, or exception.");
  }
  const triggerReason = requireStringAlias(body, "triggerReason", "trigger_reason");
  const plannedInputTokens = requireNonNegativeInteger(
    body.plannedInputTokens ?? body.planned_input_tokens,
    "plannedInputTokens"
  );
  const plannedOutputTokens = requireNonNegativeInteger(
    body.plannedOutputTokens ?? body.planned_output_tokens,
    "plannedOutputTokens"
  );
  const exceptionReason = optionalString(body, "exceptionReason") ?? optionalString(body, "exception_reason");
  const metadataInput = body.metadata;
  if (metadataInput !== undefined && !isRecord(metadataInput)) {
    throw new HttpError(400, "metadata must be a JSON object.");
  }

  const { data, error } = await rpcClient.rpc("reserve_model_usage", {
    target_policy_id: policyId,
    target_revision_id: revisionId,
    target_operation_type: operationType,
    target_provider: provider,
    target_model: model,
    target_prompt_version: promptVersion,
    target_request_hash: requestHash,
    target_budget_class: budgetClass,
    target_trigger_reason: triggerReason,
    planned_input_tokens: plannedInputTokens,
    planned_output_tokens: plannedOutputTokens,
    actor_id: actorId,
    target_exception_reason: exceptionReason,
    target_metadata: toJson(metadataInput ?? {}, "model reservation metadata")
  });
  if (error) throw mapRpcError(error, "Model budget reservation failed.");
  return data;
}

async function finalizeUsage(
  body: Record<string, unknown>,
  actorId: string,
  rpcClient: ReturnType<typeof createSupabaseAdminClient<Stage8Database>>
) {
  const usageId = requireUuid(body.usageId ?? body.usage_id, "usageId");
  const inputTokens = requireNonNegativeInteger(
    body.inputTokens ?? body.input_tokens,
    "inputTokens"
  );
  const outputTokens = requireNonNegativeInteger(
    body.outputTokens ?? body.output_tokens,
    "outputTokens"
  );
  const cachedTokens = requireNonNegativeInteger(
    body.cachedTokens ?? body.cached_tokens,
    "cachedTokens"
  );
  if (cachedTokens > inputTokens) {
    throw new HttpError(400, "cachedTokens cannot exceed inputTokens.");
  }
  const status = requireString(body, "status");
  if (status !== "succeeded" && status !== "failed") {
    throw new HttpError(400, "status must be succeeded or failed.");
  }
  const metadataInput = body.metadata;
  if (metadataInput !== undefined && !isRecord(metadataInput)) {
    throw new HttpError(400, "metadata must be a JSON object.");
  }

  const { data, error } = await rpcClient.rpc("finalize_model_usage", {
    target_usage_id: usageId,
    actual_input_tokens: inputTokens,
    actual_output_tokens: outputTokens,
    actual_cached_tokens: cachedTokens,
    target_status: status,
    actor_id: actorId,
    target_metadata: toJson(metadataInput ?? {}, "model finalization metadata")
  });
  if (error) throw mapRpcError(error, "Model budget finalization failed.");
  return data;
}

function requireStringAlias(
  body: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): string {
  const value = optionalString(body, camelKey) ?? optionalString(body, snakeKey);
  if (!value) throw new HttpError(400, `Missing required string field: ${camelKey}`);
  return value;
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new HttpError(400, `${label} must be a UUID.`);
  }
  return value.trim().toLowerCase();
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireUuid(value, label);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new HttpError(400, `${label} must be a non-negative integer.`);
  }
  return numeric;
}
