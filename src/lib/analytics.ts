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

  const { error } = await supabase.from("user_events").insert(row);
  if (error) {
    console.warn("[analytics] failed to record user event", error.message);
  }
}
