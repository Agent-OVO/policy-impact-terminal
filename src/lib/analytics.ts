import { isSupabaseConfigured, supabase } from "./supabase";

export type UserEventType =
  | "app_open"
  | "policy_list_view"
  | "policy_open"
  | "policy_view"
  | "policy_view_duration"
  | "module_click"
  | "module_view"
  | "module_view_duration"
  | "industry_node_select"
  | "company_select"
  | "navigate_back_to_list"
  | "logout";

export type TrackUserEventInput = {
  eventType: UserEventType;
  policyRef?: string;
  moduleId?: string;
  targetType?: string;
  targetId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

const SESSION_STORAGE_KEY = "policy-terminal-analytics-session-id";
const MAX_UNKNOWN_ANALYTICS_WARNINGS = 3;
const MAX_DATABASE_POLICY_WARNINGS = 1;
const knownUnknownAnalyticsWarnings = new Set<string>();
const knownDatabasePolicyWarnings = new Set<string>();

const BENIGN_ANALYTICS_ERROR_PATTERNS = [
  /\b401\b/i,
  /\bunauthenticated\b/i,
  /\bnot authenticated\b/i,
  /\bunauthorized\b/i,
  /\bjwt\b/i,
  /\bsession\b/i,
  /\brefresh token\b/i,
  /\btoken\b.*\b(expired|invalid|missing)\b/i,
  /\b(expired|invalid|missing)\b.*\btoken\b/i,
  /\bPGRST301\b/i
];

const DATABASE_POLICY_ANALYTICS_ERROR_PATTERNS = [
  /\b403\b/i,
  /\bforbidden\b/i,
  /row[-\s]level security/i,
  /\brls\b/i,
  /violates.*security policy/i,
  /\b42501\b/i
];

function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readSessionId() {
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;

    const next = createSessionId();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return createSessionId();
  }
}

function getRoutePath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    language: navigator.language
  };
}

function collectAnalyticsErrorParts(error: unknown, parts: string[], seen = new Set<object>()) {
  if (error === null || error === undefined) return;

  if (typeof error === "string" || typeof error === "number" || typeof error === "boolean") {
    parts.push(String(error));
    return;
  }

  if (typeof error !== "object") return;
  if (seen.has(error)) return;
  seen.add(error);

  if (error instanceof Error) {
    parts.push(error.name, error.message);
  }

  const record = error as Record<string, unknown>;
  for (const key of ["message", "details", "hint", "code", "status", "statusCode", "statusText", "name", "error_description"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(String(value));
    }
  }

  collectAnalyticsErrorParts(record.cause, parts, seen);
  collectAnalyticsErrorParts(record.error, parts, seen);
}

function getAnalyticsErrorSummary(error: unknown, status?: number, statusText?: string) {
  const parts: string[] = [];
  if (typeof status === "number") parts.push(String(status));
  if (statusText) parts.push(statusText);

  collectAnalyticsErrorParts(error, parts);

  const summary = Array.from(new Set(parts.map((part) => part.trim()).filter(Boolean))).join(" | ");
  return summary || "unknown analytics error";
}

function isBenignAnalyticsError(error: unknown, status?: number, statusText?: string) {
  if (status === 401) return true;

  const summary = getAnalyticsErrorSummary(error, status, statusText);
  return BENIGN_ANALYTICS_ERROR_PATTERNS.some((pattern) => pattern.test(summary));
}

function isDatabasePolicyAnalyticsError(summary: string, status?: number) {
  if (status === 403) return true;
  return DATABASE_POLICY_ANALYTICS_ERROR_PATTERNS.some((pattern) => pattern.test(summary));
}

function warnDatabasePolicyAnalyticsError(error: unknown, summary: string) {
  const signature = summary.slice(0, 240);

  if (knownDatabasePolicyWarnings.has(signature)) return;
  if (knownDatabasePolicyWarnings.size >= MAX_DATABASE_POLICY_WARNINGS) return;

  knownDatabasePolicyWarnings.add(signature);
  console.warn("[analytics] user event rejected by database policy", summary, error);
}

function warnUnknownAnalyticsError(error: unknown, status?: number, statusText?: string) {
  const summary = getAnalyticsErrorSummary(error, status, statusText);
  const signature = summary.slice(0, 240);

  if (knownUnknownAnalyticsWarnings.has(signature)) return;
  if (knownUnknownAnalyticsWarnings.size >= MAX_UNKNOWN_ANALYTICS_WARNINGS) return;

  knownUnknownAnalyticsWarnings.add(signature);
  console.warn("[analytics] failed to record user event", summary, error);
}

function handleAnalyticsError(error: unknown, status?: number, statusText?: string) {
  if (isBenignAnalyticsError(error, status, statusText)) return;

  const summary = getAnalyticsErrorSummary(error, status, statusText);
  if (isDatabasePolicyAnalyticsError(summary, status)) {
    warnDatabasePolicyAnalyticsError(error, summary);
    return;
  }

  warnUnknownAnalyticsError(error, status, statusText);
}

export function getAnalyticsSessionId() {
  return readSessionId();
}

export async function trackUserEvent(userId: string | undefined, input: TrackUserEventInput) {
  if (!isSupabaseConfigured || !supabase || !userId) return;

  const row = {
    user_id: userId,
    session_id: readSessionId(),
    event_type: input.eventType,
    policy_ref: input.policyRef ?? null,
    module_id: input.moduleId ?? null,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    duration_ms: input.durationMs ?? null,
    route_path: getRoutePath(),
    viewport: getViewport(),
    metadata: input.metadata ?? {}
  };

  try {
    const { error, status, statusText } = await supabase.from("user_events").insert(row);
    if (error) {
      handleAnalyticsError(error, status, statusText);
    }
  } catch (error) {
    handleAnalyticsError(error);
  }
}
