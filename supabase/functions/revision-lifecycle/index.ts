import {
  errorResponse,
  handleOptions,
  HttpError,
  jsonResponse,
  optionalString,
  readJsonObject,
  requirePost,
  requireString
} from "../_shared/http.ts";
import type { Stage8Database } from "../_shared/database.stage8.types.ts";
import { mapRpcError } from "../_shared/rpcError.ts";
import {
  createSupabaseAdminClient,
  requireActiveAdminUser
} from "../_shared/supabaseAdmin.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    requirePost(req);
    const body = await readJsonObject(req);
    const action = requireString(body, "action");
    if (action !== "publish" && action !== "rollback") {
      throw new HttpError(400, "action must be publish or rollback.");
    }

    const policyId = requireUuid(body.policyId ?? body.policy_id, "policyId");
    const revisionId = requireUuid(body.revisionId ?? body.revision_id, "revisionId");
    const idempotencyKey = requireStringAlias(body, "idempotencyKey", "idempotency_key");
    const expectedCurrentRevisionId = optionalUuid(
      body.expectedCurrentRevisionId ?? body.expected_current_revision_id,
      "expectedCurrentRevisionId"
    );

    const authClient = createSupabaseAdminClient();
    const actor = await requireActiveAdminUser(req, authClient);
    const rpcClient = createSupabaseAdminClient<Stage8Database>();
    const functionName = action === "publish"
      ? "publish_report_revision"
      : "rollback_report_revision";
    const { data, error } = await rpcClient.rpc(functionName, {
      target_policy_id: policyId,
      target_revision_id: revisionId,
      idempotency_key: idempotencyKey,
      actor_id: actor.id,
      expected_current_revision_id: expectedCurrentRevisionId
    });

    if (error) throw mapRpcError(error);
    return jsonResponse({
      action,
      actorId: actor.id,
      result: data
    });
  } catch (error) {
    return errorResponse(error);
  }
});

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
