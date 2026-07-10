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
    const authClient = createSupabaseAdminClient();
    const actor = await requireActiveAdminUser(req, authClient);
    const rpcClient = createSupabaseAdminClient<Stage8Database>();

    if (action === "suspend" || action === "reactivate") {
      const targetUserId = requireUuid(body.targetUserId ?? body.target_user_id, "targetUserId");
      const reason = optionalString(body, "reason");
      if (!reason) throw new HttpError(400, "reason is required.");
      const { data, error } = await rpcClient.rpc("set_user_account_status", {
        target_user_id: targetUserId,
        target_status: action === "suspend" ? "suspended" : "active",
        actor_id: actor.id,
        reason
      });
      if (error) throw mapRpcError(error, "Account status update failed.");
      return jsonResponse({ action, actorId: actor.id, result: data });
    }

    if (action === "purgeEvents") {
      const referenceTime = optionalString(body, "referenceTime") ?? optionalString(body, "reference_time");
      if (referenceTime && Number.isNaN(Date.parse(referenceTime))) {
        throw new HttpError(400, "referenceTime must be an ISO date-time.");
      }
      const { data, error } = await rpcClient.rpc("purge_expired_user_events", {
        actor_id: actor.id,
        reference_time: referenceTime
      });
      if (error) throw mapRpcError(error, "User event retention purge failed.");
      return jsonResponse({ action, actorId: actor.id, result: data });
    }

    if (action === "delete") {
      const targetUserId = requireUuid(body.targetUserId ?? body.target_user_id, "targetUserId");
      const requestKey = requireStringAlias(body, "requestKey", "request_key");
      const reason = optionalString(body, "reason");
      if (!reason) throw new HttpError(400, "reason is required.");
      const confirmation = requireString(body, "confirmation");
      const expectedConfirmation = `DELETE:${targetUserId}`;
      if (confirmation !== expectedConfirmation) {
        throw new HttpError(400, `confirmation must equal ${expectedConfirmation}.`);
      }

      const { data: prepareData, error: prepareError } = await rpcClient.rpc(
        "prepare_account_deletion",
        {
          target_user_id: targetUserId,
          request_key: requestKey,
          actor_id: actor.id,
          reason
        }
      );
      if (prepareError) throw mapRpcError(prepareError, "Account deletion preparation failed.");

      const prepared = requireRpcRecord(prepareData, "account deletion preparation");
      const requestId = requireUuid(prepared.requestId, "prepared requestId");
      const requestStatus = requireRpcString(prepared.status, "prepared status");

      if (requestStatus === "completed") {
        return jsonResponse({
          action,
          actorId: actor.id,
          result: prepared,
          authUserDeleted: true,
          idempotentReplay: true
        });
      }
      if (requestStatus === "failed") {
        throw new HttpError(
          409,
          "This deletion request previously failed and was recovered. Submit a new requestKey after reviewing the failure."
        );
      }
      if (requestStatus !== "prepared") {
        throw new HttpError(500, `Unexpected deletion request status: ${requestStatus}.`);
      }

      const lookup = await authClient.auth.admin.getUserById(targetUserId);
      if (lookup.error && !isMissingAuthUser(lookup.error)) {
        await finalizeDeletionFailure(
          rpcClient,
          requestId,
          actor.id,
          `Auth user lookup failed: ${lookup.error.message}`
        );
        throw new HttpError(502, "Auth user lookup failed; profile access was restored.", lookup.error);
      }

      if (!lookup.error && lookup.data.user) {
        const deletion = await authClient.auth.admin.deleteUser(targetUserId);
        if (deletion.error) {
          await finalizeDeletionFailure(
            rpcClient,
            requestId,
            actor.id,
            `Auth user deletion failed: ${deletion.error.message}`
          );
          throw new HttpError(502, "Auth user deletion failed; profile access was restored.", deletion.error);
        }
      }

      const completed = await finalizeDeletion(
        rpcClient,
        requestId,
        true,
        actor.id,
        null
      );
      return jsonResponse({
        action,
        actorId: actor.id,
        result: completed,
        authUserDeleted: true,
        idempotentReplay: Boolean(prepared.idempotentReplay)
      });
    }

    throw new HttpError(400, "action must be suspend, reactivate, purgeEvents, or delete.");
  } catch (error) {
    return errorResponse(error);
  }
});

async function finalizeDeletionFailure(
  rpcClient: ReturnType<typeof createSupabaseAdminClient<Stage8Database>>,
  requestId: string,
  actorId: string,
  message: string
): Promise<void> {
  try {
    await finalizeDeletion(rpcClient, requestId, false, actorId, message);
  } catch (recoveryError) {
    throw new HttpError(
      500,
      "Auth deletion failed and profile recovery could not be finalized. Immediate administrator review is required.",
      { deletionError: message, recoveryError }
    );
  }
}

async function finalizeDeletion(
  rpcClient: ReturnType<typeof createSupabaseAdminClient<Stage8Database>>,
  requestId: string,
  succeeded: boolean,
  actorId: string,
  errorMessage: string | null
): Promise<Record<string, unknown>> {
  const { data, error } = await rpcClient.rpc("finalize_account_deletion", {
    target_request_id: requestId,
    succeeded,
    actor_id: actorId,
    deletion_error_message: errorMessage
  });
  if (error) throw mapRpcError(error, "Account deletion finalization failed.");
  return requireRpcRecord(data, "account deletion finalization");
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

function requireRpcRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new HttpError(500, `${label} returned a non-object result.`);
  return value;
}

function requireRpcString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(500, `${label} is missing from the RPC result.`);
  }
  return value.trim();
}

function isMissingAuthUser(error: { status?: number; code?: string; message?: string }): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return error.status === 404
    || error.code === "user_not_found"
    || message.includes("user not found");
}
