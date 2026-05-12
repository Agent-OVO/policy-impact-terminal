export type AdminProfileRole = "user" | "analyst" | "admin" | "unknown" | (string & {});
export type AdminProfileStatus = "active" | "invited" | "suspended" | "deleted" | "unknown" | (string & {});

export type AdminBehaviorEventType =
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
  | "logout"
  | (string & {});

export type AdminBehaviorModuleId =
  | "brief"
  | "industry"
  | "clauses"
  | "background"
  | "compare"
  | "companies"
  | "evidence"
  | (string & {});

export type AdminBehaviorSource =
  | "navigation"
  | "top_tabs"
  | "sidebar"
  | "companies"
  | "company_cards"
  | "company_matrix"
  | "search"
  | "list"
  | "top_tab"
  | "content"
  | "direct"
  | "official"
  | "media"
  | "research"
  | "exchange"
  | "company"
  | "other"
  | (string & {});

export type AdminTimeGranularity = "hour" | "day" | "week" | "month";

export interface CurrentUserAccess {
  userId: string;
  role: AdminProfileRole;
  status: AdminProfileStatus;
  isActive: boolean;
  isAdmin: boolean;
  canAccessAdmin: boolean;
}

export interface AdminBehaviorFilters {
  startDate?: string;
  endDate?: string;
  granularity?: AdminTimeGranularity;
  search?: string;
  eventTypes?: AdminBehaviorEventType[];
  moduleIds?: AdminBehaviorModuleId[];
  policyRef?: string;
  userId?: string;
  sessionId?: string;
  source?: AdminBehaviorSource;
  limit?: number;
  offset?: number;
}

export interface AdminBehaviorSummary {
  totalUsers: number;
  todayActiveUsers: number;
  last7dActiveUsers: number;
  totalEvents: number;
  uniqueUsers: number;
  totalSessions: number;
  activePolicies: number;
  policyViewEvents: number;
  policyOpenEvents: number;
  avgPolicyViewMs: number;
  avgDurationMs: number;
  totalDurationMs: number;
  avgEventsPerUser: number;
  returningUsers: number;
  bounceUsers: number;
}

export interface AdminBehaviorSeriesPoint {
  bucket: string;
  label: string;
  eventCount: number;
  uniqueUsers: number;
  sessionCount: number;
  durationMs: number;
}

export interface AdminBehaviorTopPolicy {
  policyRef: string;
  title: string;
  source?: string;
  eventCount: number;
  uniqueUsers: number;
  sessionCount: number;
  avgDurationMs: number;
  lastSeenAt?: string;
}

export interface AdminBehaviorTopModule {
  moduleId: AdminBehaviorModuleId;
  moduleLabel: string;
  eventCount: number;
  uniqueUsers: number;
  sessionCount: number;
  avgDurationMs: number;
  lastSeenAt?: string;
}

export interface AdminBehaviorSourceMetric {
  source: AdminBehaviorSource;
  sourceLabel: string;
  eventCount: number;
  uniqueUsers: number;
}

export interface AdminBehaviorEventMetric {
  eventType: AdminBehaviorEventType;
  eventLabel: string;
  eventCount: number;
  uniqueUsers: number;
}

export interface AdminBehaviorUserRow {
  userId: string;
  displayName: string;
  email?: string;
  role?: AdminProfileRole;
  status?: AdminProfileStatus;
  eventCount: number;
  sessionCount: number;
  policyCount: number;
  moduleCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
}

export interface AdminBehaviorTimelineItem {
  id: string;
  occurredAt: string;
  userId: string;
  displayName: string;
  eventType: AdminBehaviorEventType;
  eventLabel: string;
  policyRef?: string;
  policyTitle?: string;
  moduleId?: AdminBehaviorModuleId;
  moduleLabel?: string;
  targetType?: string;
  targetId?: string;
  source?: AdminBehaviorSource;
  sourceLabel?: string;
  durationMs?: number;
  routePath?: string;
  sessionId?: string;
  metadata: Record<string, unknown>;
}

export interface AdminBehaviorOverview {
  summary: AdminBehaviorSummary;
  series: AdminBehaviorSeriesPoint[];
  topPolicies: AdminBehaviorTopPolicy[];
  topModules: AdminBehaviorTopModule[];
  topSources: AdminBehaviorSourceMetric[];
  eventBreakdown: AdminBehaviorEventMetric[];
  updatedAt?: string;
}

export interface AdminBehaviorListResult {
  rows: AdminBehaviorUserRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminBehaviorDetail {
  user: AdminBehaviorUserRow | null;
  summary: AdminBehaviorSummary;
  series: AdminBehaviorSeriesPoint[];
  topPolicies: AdminBehaviorTopPolicy[];
  topModules: AdminBehaviorTopModule[];
  timeline: AdminBehaviorTimelineItem[];
}

export type AdminAnalyticsFilters = AdminBehaviorFilters;
export type AdminAnalyticsSummary = AdminBehaviorSummary;
export type AdminAnalyticsSeriesPoint = AdminBehaviorSeriesPoint;
export type AdminAnalyticsTopPolicy = AdminBehaviorTopPolicy;
export type AdminAnalyticsTopModule = AdminBehaviorTopModule;
export type AdminAnalyticsUserRow = AdminBehaviorUserRow;
export type AdminAnalyticsTimelineItem = AdminBehaviorTimelineItem;
export type AdminAnalyticsOverview = AdminBehaviorOverview;
export type AdminAnalyticsListResult = AdminBehaviorListResult;
export type AdminAnalyticsDetail = AdminBehaviorDetail;

export const ADMIN_BEHAVIOR_EVENT_LABELS: Record<string, string> = {
  app_open: "打开应用",
  policy_list_view: "查看政策列表",
  policy_open: "打开政策",
  policy_view: "查看政策详情",
  policy_view_duration: "政策停留时长",
  module_click: "切换模块",
  module_view: "查看模块",
  module_view_duration: "模块停留时长",
  industry_node_select: "选择产业节点",
  company_select: "选择公司",
  navigate_back_to_list: "返回列表",
  logout: "退出登录"
};

export const ADMIN_BEHAVIOR_MODULE_LABELS: Record<string, string> = {
  brief: "政策速览",
  industry: "产业链图谱",
  clauses: "条款拆解",
  background: "背景研判",
  compare: "政策对比",
  companies: "公司影响",
  evidence: "证据链"
};

export const ADMIN_BEHAVIOR_SOURCE_LABELS: Record<string, string> = {
  navigation: "导航切换",
  top_tabs: "顶部标签",
  sidebar: "侧边栏",
  companies: "公司模块",
  company_cards: "公司卡片",
  company_matrix: "公司矩阵",
  search: "搜索",
  list: "列表",
  direct: "直接访问",
  official: "官方来源",
  media: "媒体来源",
  research: "研究机构",
  exchange: "交易所",
  company: "公司公告",
  other: "其他来源"
};

export const adminEventLabelMap = ADMIN_BEHAVIOR_EVENT_LABELS;
export const adminModuleLabelMap = ADMIN_BEHAVIOR_MODULE_LABELS;
export const adminSourceLabelMap = ADMIN_BEHAVIOR_SOURCE_LABELS;

export const EMPTY_ADMIN_BEHAVIOR_SUMMARY: AdminBehaviorSummary = {
  totalUsers: 0,
  todayActiveUsers: 0,
  last7dActiveUsers: 0,
  totalEvents: 0,
  uniqueUsers: 0,
  totalSessions: 0,
  activePolicies: 0,
  policyViewEvents: 0,
  policyOpenEvents: 0,
  avgPolicyViewMs: 0,
  avgDurationMs: 0,
  totalDurationMs: 0,
  avgEventsPerUser: 0,
  returningUsers: 0,
  bounceUsers: 0
};

export function formatAdminEventType(eventType: string | null | undefined): string {
  if (!eventType) return "未知事件";
  return ADMIN_BEHAVIOR_EVENT_LABELS[eventType] ?? formatUnknownKey(eventType);
}

export const formatAdminEventLabel = formatAdminEventType;

export function formatAdminModuleId(moduleId: string | null | undefined): string {
  if (!moduleId) return "未标注模块";
  return ADMIN_BEHAVIOR_MODULE_LABELS[moduleId] ?? formatUnknownKey(moduleId);
}

export const formatAdminModuleLabel = formatAdminModuleId;

export function formatAdminSource(source: string | null | undefined): string {
  if (!source) return "未标注来源";
  return ADMIN_BEHAVIOR_SOURCE_LABELS[source] ?? formatUnknownKey(source);
}

export const formatAdminSourceLabel = formatAdminSource;

export function formatAdminDuration(ms: number | null | undefined): string {
  const value = Number(ms ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 秒";

  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds} 秒`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
}

export function formatAdminNumber(value: number | null | undefined): string {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("zh-CN").format(number);
}

export function formatAdminPercent(value: number | null | undefined): string {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0%";
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    maximumFractionDigits: number >= 0.1 ? 0 : 1
  }).format(number);
}

export function formatAdminDateTime(value: string | null | undefined): string {
  if (!value) return "时间未知";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatAdminDate(value: string | null | undefined): string {
  if (!value) return "日期未知";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatUnknownKey(value: string): string {
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
