export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-crawler-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export class HttpError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

export function handleOptions(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export function requirePost(req: Request): void {
  if (req.method !== "POST") {
    throw new HttpError(405, "Only POST requests are supported.");
  }
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }

  if (!isRecord(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  return body;
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `Missing required string field: ${key}`);
  }

  return value.trim();
}

export function optionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message, details: error.details }, error.status);
  }

  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse({ error: message }, 500);
}
