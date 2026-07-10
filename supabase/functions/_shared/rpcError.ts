import { HttpError } from "./http.ts";

export type RpcErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export function mapRpcError(
  error: RpcErrorLike,
  fallbackMessage = "Database RPC failed."
): HttpError {
  const code = error.code ?? "";
  const status = code === "42501"
    ? 403
    : code === "P0002"
      ? 404
      : code === "23505" || code === "40001"
        ? 409
        : code === "22023" || code === "23514"
          ? 400
          : code.startsWith("PGRST")
            ? 503
            : 500;
  return new HttpError(status, error.message || fallbackMessage, error);
}
