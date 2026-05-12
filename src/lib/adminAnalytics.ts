import {
  EMPTY_ADMIN_BEHAVIOR_SUMMARY,
  formatAdminEventType,
  formatAdminModuleId,
  formatAdminSource
} from "../types/analytics";
import type {
  AdminBehaviorDetail,
  AdminBehaviorEventMetric,
  AdminBehaviorFilters,
  AdminBehaviorListResult,
  AdminBehaviorModuleId,
  AdminBehaviorOverview,
  AdminBehaviorSeriesPoint,
  AdminBehaviorSource,
  AdminBehaviorSourceMetric,
  AdminBehaviorSummary,
  AdminBehaviorTimelineItem,
  AdminBehaviorTopModule,
  AdminBehaviorTopPolicy,
  AdminBehaviorUserRow
} from "../types/analytics";
import { isSupabaseConfigured, supabase } from "./supabase";

type AdminAnalyticsOperation =
  | "fetchAdminBehaviorOverview"
  | "fetchAdminBehaviorList"
  | "fetchAdminBehaviorDetail";

type JsonRecord = Record<string, unknown>;

export const ADMIN_BEHAVIOR_RPC = {
  overview: "admin_behavior_overview",
  list: "admin_behavior_list",
  detail: "admin_behavior_detail"
} as const;

export class AdminAnalyticsError extends Error {
  public readonly operation: AdminAnalyticsOperation;
  public readonly cause?: unknown;

  constructor(operation: AdminAnalyticsOperation, message: string, cause?: unknown) {
    super(message);
    this.name = "AdminAnalyticsError";
    this.operation = operation;
    this.cause = cause;
  }
}

export async function fetchAdminBehaviorOverview(filters: AdminBehaviorFilters = {}): Promise<AdminBehaviorOverview> {
  const data = await callAdminAnalyticsRpc("fetchAdminBehaviorOverview", ADMIN_BEHAVIOR_RPC.overview, filters);
  return normalizeOverview(data);
}

export async function fetchAdminBehaviorList(filters: AdminBehaviorFilters = {}): Promise<AdminBehaviorListResult> {
  const data = await callAdminAnalyticsRpc("fetchAdminBehaviorList", ADMIN_BEHAVIOR_RPC.list, filters);
  return normalizeListResult(data, filters);
}

export function fetchAdminBehaviorDetail(
  userId: string,
  filters?: Omit<AdminBehaviorFilters, "userId">
): Promise<AdminBehaviorDetail>;
export function fetchAdminBehaviorDetail(filters: AdminBehaviorFilters & { userId?: string }): Promise<AdminBehaviorDetail>;
export async function fetchAdminBehaviorDetail(
  input: string | (AdminBehaviorFilters & { userId?: string }) = {},
  filters: Omit<AdminBehaviorFilters, "userId"> = {}
): Promise<AdminBehaviorDetail> {
  const normalizedFilters = typeof input === "string" ? { ...filters, userId: input } : input;
  const data = await callAdminAnalyticsRpc("fetchAdminBehaviorDetail", ADMIN_BEHAVIOR_RPC.detail, normalizedFilters);
  return normalizeDetail(data, normalizedFilters);
}

async function callAdminAnalyticsRpc(
  operation: AdminAnalyticsOperation,
  rpcName: string,
  filters: AdminBehaviorFilters
): Promise<unknown> {
  if (!isSupabaseConfigured || !supabase) {
    throw new AdminAnalyticsError(operation, "尚未配置 Supabase，无法读取管理员分析数据。");
  }

  const { data, error } = await supabase.rpc(rpcName, toRpcArgs(filters));

  if (error) {
    throw new AdminAnalyticsError(operation, getErrorMessage(error), error);
  }

  return data;
}

function toRpcArgs(filters: AdminBehaviorFilters): JsonRecord {
  return {
    start_date: filters.startDate ?? null,
    end_date: filters.endDate ?? null,
    granularity: filters.granularity ?? "day",
    search_text: filters.search ?? null,
    event_types: filters.eventTypes?.length ? filters.eventTypes : null,
    module_ids: filters.moduleIds?.length ? filters.moduleIds : null,
    policy_ref: filters.policyRef ?? null,
    user_id: filters.userId ?? null,
    session_id: filters.sessionId ?? null,
    source: filters.source ?? null,
    limit_count: filters.limit ?? null,
    offset_count: filters.offset ?? null
  };
}

function normalizeOverview(value: unknown): AdminBehaviorOverview {
  const record = asRecord(value);

  return {
    summary: normalizeSummary(readValue(record, ["summary", "totals", "metrics"])),
    series: readArray(record, ["series", "eventSeries", "event_series", "timelineSeries", "timeline_series", "eventsByDay", "events_by_day"])
      .map(normalizeSeriesPoint),
    topPolicies: readArray(record, ["topPolicies", "top_policies", "policies"]).map(normalizeTopPolicy),
    topModules: readArray(record, ["topModules", "top_modules", "modules"]).map(normalizeTopModule),
    topSources: readArray(record, ["topSources", "top_sources", "sources"]).map(normalizeSourceMetric),
    eventBreakdown: readArray(record, ["eventBreakdown", "event_breakdown", "eventsByType", "events_by_type"]).map(normalizeEventMetric),
    updatedAt: readString(record, ["updatedAt", "updated_at"])
  };
}

function normalizeListResult(value: unknown, filters: AdminBehaviorFilters): AdminBehaviorListResult {
  if (Array.isArray(value)) {
    return {
      rows: value.map(normalizeUserRow),
      total: value.length,
      limit: filters.limit ?? value.length,
      offset: filters.offset ?? 0
    };
  }

  const record = asRecord(value);
  const rows = readArray(record, ["rows", "users", "items", "data"]).map(normalizeUserRow);
  const pagination = readRecord(record, ["pagination", "page"]);

  return {
    rows,
    total: readNumber(record, ["total", "totalCount", "total_count"], readNumber(pagination, ["total", "totalRows", "total_rows"], rows.length)),
    limit: readNumber(record, ["limit", "limitCount", "limit_count"], readNumber(pagination, ["limit", "limitCount", "limit_count"], filters.limit ?? rows.length)),
    offset: readNumber(record, ["offset", "offsetCount", "offset_count"], readNumber(pagination, ["offset", "offsetCount", "offset_count"], filters.offset ?? 0))
  };
}

function normalizeDetail(value: unknown, filters: AdminBehaviorFilters): AdminBehaviorDetail {
  const record = asRecord(value);
  const userValue = readValue(record, ["user", "profile"]);

  return {
    user: userValue ? normalizeUserRow(userValue) : null,
    summary: normalizeSummary(readValue(record, ["summary", "totals", "metrics"])),
    series: readArray(record, ["series", "eventSeries", "event_series", "eventsByDay", "events_by_day"]).map(normalizeSeriesPoint),
    topPolicies: readArray(record, ["topPolicies", "top_policies", "policies"]).map(normalizeTopPolicy),
    topModules: readArray(record, ["topModules", "top_modules", "modules"]).map(normalizeTopModule),
    timeline: readArray(record, ["timeline", "events", "rows", "items"]).map((item) =>
      normalizeTimelineItem(item, filters.userId)
    )
  };
}

function normalizeSummary(value: unknown): AdminBehaviorSummary {
  const record = asRecord(value);

  return {
    ...EMPTY_ADMIN_BEHAVIOR_SUMMARY,
    totalUsers: readNumber(record, ["totalUsers", "total_users"]),
    todayActiveUsers: readNumber(record, ["todayActiveUsers", "today_active_users"]),
    last7dActiveUsers: readNumber(record, ["last7dActiveUsers", "last_7d_active_users", "last7DaysActiveUsers", "last_7_days_active_users"]),
    totalEvents: readNumber(record, ["totalEvents", "total_events", "eventCount", "event_count"]),
    uniqueUsers: readNumber(record, ["uniqueUsers", "unique_users", "userCount", "user_count", "activeUsers", "active_users"]),
    totalSessions: readNumber(record, ["totalSessions", "total_sessions", "sessionCount", "session_count"]),
    activePolicies: readNumber(record, ["activePolicies", "active_policies", "policyCount", "policy_count"]),
    policyViewEvents: readNumber(record, ["policyViewEvents", "policy_view_events", "policyViews", "policy_views"]),
    policyOpenEvents: readNumber(record, ["policyOpenEvents", "policy_open_events", "policyOpens", "policy_opens"]),
    avgPolicyViewMs: readNumber(record, ["avgPolicyViewMs", "avg_policy_view_ms", "avgPolicyDurationMs", "avg_policy_duration_ms"]),
    avgDurationMs: readNumber(record, ["avgDurationMs", "avg_duration_ms", "averageDurationMs", "average_duration_ms"]),
    totalDurationMs: readNumber(record, ["totalDurationMs", "total_duration_ms", "durationMs", "duration_ms"]),
    avgEventsPerUser: readNumber(record, ["avgEventsPerUser", "avg_events_per_user"]),
    returningUsers: readNumber(record, ["returningUsers", "returning_users"]),
    bounceUsers: readNumber(record, ["bounceUsers", "bounce_users"])
  };
}

function normalizeSeriesPoint(value: unknown): AdminBehaviorSeriesPoint {
  const record = asRecord(value);
  const bucket = readString(record, ["bucket", "date", "day", "hour", "occurredAt", "occurred_at"]) ?? "";

  return {
    bucket,
    label: readString(record, ["label"]) ?? bucket,
    eventCount: readNumber(record, ["eventCount", "event_count", "count"]),
    uniqueUsers: readNumber(record, ["uniqueUsers", "unique_users", "userCount", "user_count", "activeUsers", "active_users"]),
    sessionCount: readNumber(record, ["sessionCount", "session_count"]),
    durationMs: readNumber(record, ["durationMs", "duration_ms", "totalDurationMs", "total_duration_ms"])
  };
}

function normalizeTopPolicy(value: unknown): AdminBehaviorTopPolicy {
  const record = asRecord(value);
  const policyRef = readString(record, ["policyRef", "policy_ref", "id"]) ?? "unknown-policy";

  return {
    policyRef,
    title: readString(record, ["title", "policyTitle", "policy_title"]) ?? policyRef,
    source: readString(record, ["source", "sourceName", "source_name"]),
    eventCount: readNumber(record, ["eventCount", "event_count", "count"]),
    uniqueUsers: readNumber(record, ["uniqueUsers", "unique_users", "userCount", "user_count", "activeUsers", "active_users"]),
    sessionCount: readNumber(record, ["sessionCount", "session_count"]),
    avgDurationMs: readNumber(record, ["avgDurationMs", "avg_duration_ms", "durationMs", "duration_ms"]),
    lastSeenAt: readString(record, ["lastSeenAt", "last_seen_at", "lastOccurredAt", "last_occurred_at"])
  };
}

function normalizeTopModule(value: unknown): AdminBehaviorTopModule {
  const record = asRecord(value);
  const moduleId = (readString(record, ["moduleId", "module_id", "id"]) ?? "unknown") as AdminBehaviorModuleId;

  return {
    moduleId,
    moduleLabel: readString(record, ["moduleLabel", "module_label", "label"]) ?? formatAdminModuleId(moduleId),
    eventCount: readNumber(record, ["eventCount", "event_count", "count"]),
    uniqueUsers: readNumber(record, ["uniqueUsers", "unique_users", "userCount", "user_count", "activeUsers", "active_users"]),
    sessionCount: readNumber(record, ["sessionCount", "session_count"]),
    avgDurationMs: readNumber(record, ["avgDurationMs", "avg_duration_ms", "durationMs", "duration_ms"]),
    lastSeenAt: readString(record, ["lastSeenAt", "last_seen_at", "lastOccurredAt", "last_occurred_at"])
  };
}

function normalizeSourceMetric(value: unknown): AdminBehaviorSourceMetric {
  const record = asRecord(value);
  const source = (readString(record, ["source", "eventSource", "event_source"]) ?? "other") as AdminBehaviorSource;

  return {
    source,
    sourceLabel: readString(record, ["sourceLabel", "source_label", "label"]) ?? formatAdminSource(source),
    eventCount: readNumber(record, ["eventCount", "event_count", "count"]),
    uniqueUsers: readNumber(record, ["uniqueUsers", "unique_users", "userCount", "user_count", "activeUsers", "active_users"])
  };
}

function normalizeEventMetric(value: unknown): AdminBehaviorEventMetric {
  const record = asRecord(value);
  const eventType = (readString(record, ["eventType", "event_type", "id"]) ?? "unknown") as AdminBehaviorEventMetric["eventType"];

  return {
    eventType,
    eventLabel: readString(record, ["eventLabel", "event_label", "label"]) ?? formatAdminEventType(eventType),
    eventCount: readNumber(record, ["eventCount", "event_count", "count"]),
    uniqueUsers: readNumber(record, ["uniqueUsers", "unique_users", "userCount", "user_count", "activeUsers", "active_users"])
  };
}

function normalizeUserRow(value: unknown): AdminBehaviorUserRow {
  const record = asRecord(value);
  const userId = readString(record, ["userId", "user_id", "id"]) ?? "";
  const email = readString(record, ["email"]);
  const displayName =
    formatAdminDisplayName(readString(record, ["displayName", "display_name", "name"]), email) ??
    (userId ? `用户 ${userId.slice(0, 8)}` : "未知用户");

  return {
    userId,
    displayName,
    email,
    role: readString(record, ["role"]) as AdminBehaviorUserRow["role"],
    status: readString(record, ["status"]) as AdminBehaviorUserRow["status"],
    eventCount: readNumber(record, ["eventCount", "event_count", "count"]),
    sessionCount: readNumber(record, ["sessionCount", "session_count"]),
    policyCount: readNumber(record, ["policyCount", "policy_count"]),
    moduleCount: readNumber(record, ["moduleCount", "module_count"]),
    totalDurationMs: readNumber(record, ["totalDurationMs", "total_duration_ms", "durationMs", "duration_ms"]),
    avgDurationMs: readNumber(record, ["avgDurationMs", "avg_duration_ms"]),
    firstSeenAt: readString(record, ["firstSeenAt", "first_seen_at", "firstOccurredAt", "first_occurred_at", "firstSeen", "first_seen"]),
    lastSeenAt: readString(record, ["lastSeenAt", "last_seen_at", "lastOccurredAt", "last_occurred_at", "lastSeen", "last_seen"])
  };
}

function normalizeTimelineItem(value: unknown, fallbackUserId?: string): AdminBehaviorTimelineItem {
  const record = asRecord(value);
  const metadata = readRecord(record, ["metadata"]);
  const eventType = (readString(record, ["eventType", "event_type"]) ?? "unknown") as AdminBehaviorTimelineItem["eventType"];
  const moduleId = readString(record, ["moduleId", "module_id"]) as AdminBehaviorModuleId | undefined;
  const source = (readString(record, ["source", "eventSource", "event_source"]) ??
    readString(metadata, ["source"])) as AdminBehaviorSource | undefined;
  const userId = readString(record, ["userId", "user_id"]) ?? fallbackUserId ?? "";
  const email = readString(record, ["email"]);
  const displayName =
    formatAdminDisplayName(readString(record, ["displayName", "display_name", "name"]), email) ??
    (userId ? `用户 ${userId.slice(0, 8)}` : "未知用户");

  return {
    id: readString(record, ["id", "eventId", "event_id"]) ?? createTimelineFallbackId(record),
    occurredAt: readString(record, ["occurredAt", "occurred_at", "createdAt", "created_at"]) ?? "",
    userId,
    displayName,
    eventType,
    eventLabel: readString(record, ["eventLabel", "event_label"]) ?? formatAdminEventType(eventType),
    policyRef: readString(record, ["policyRef", "policy_ref"]),
    policyTitle: readString(record, ["policyTitle", "policy_title", "title"]),
    moduleId,
    moduleLabel: moduleId ? formatAdminModuleId(moduleId) : undefined,
    targetType: readString(record, ["targetType", "target_type"]),
    targetId: readString(record, ["targetId", "target_id"]),
    source,
    sourceLabel: source ? formatAdminSource(source) : undefined,
    durationMs: readOptionalNumber(record, ["durationMs", "duration_ms"]),
    routePath: readString(record, ["routePath", "route_path"]),
    sessionId: readString(record, ["sessionId", "session_id"]),
    metadata
  };
}

function formatAdminDisplayName(name: string | undefined, email: string | undefined): string | undefined {
  const value = name || email;
  if (!value) return undefined;

  const internalSuffix = "@users.policy-impact-terminal.invalid";
  if (value.endsWith(internalSuffix)) return value.slice(0, -internalSuffix.length);
  return value;
}

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  return {};
}

function readRecord(record: JsonRecord, keys: string[]): JsonRecord {
  const value = readValue(record, keys);
  return asRecord(value);
}

function readArray(record: JsonRecord, keys: string[]): unknown[] {
  const value = readValue(record, keys);
  return Array.isArray(value) ? value : [];
}

function readValue(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }

  return undefined;
}

function readString(record: JsonRecord, keys: string[]): string | undefined {
  const value = readValue(record, keys);
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function readNumber(record: JsonRecord, keys: string[], fallback = 0): number {
  return readOptionalNumber(record, keys) ?? fallback;
}

function readOptionalNumber(record: JsonRecord, keys: string[]): number | undefined {
  const value = readValue(record, keys);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function createTimelineFallbackId(record: JsonRecord): string {
  const eventType = readString(record, ["eventType", "event_type"]) ?? "event";
  const occurredAt = readString(record, ["occurredAt", "occurred_at", "createdAt", "created_at"]) ?? Date.now().toString();
  const userId = readString(record, ["userId", "user_id"]) ?? "user";
  return `${eventType}-${userId}-${occurredAt}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;

  const record = asRecord(error);
  return (
    readString(record, ["message"]) ??
    readString(record, ["details"]) ??
    readString(record, ["hint"]) ??
    "管理员分析数据读取失败。"
  );
}
