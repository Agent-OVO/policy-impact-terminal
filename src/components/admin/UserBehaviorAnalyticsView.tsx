import { useEffect, useId, useMemo, useState } from "react";
import { AdminAccessGuard, type AdminAccessGuardUser } from "./AdminAccessGuard";
import {
  AnalyticsCharts,
  type AnalyticsDistributionMetric,
  type AnalyticsRankedMetric,
  type AnalyticsTrendPoint
} from "./AnalyticsCharts";

export type AdminAnalyticsTimeRange = "24h" | "7d" | "30d" | "90d" | "custom";

export type AdminAnalyticsFilters = {
  timeRange: AdminAnalyticsTimeRange;
  from?: string;
  to?: string;
  policyId?: string;
  moduleId?: string;
  eventType?: string;
  username?: string;
};

export type AdminAnalyticsFilterOption = {
  value: string;
  label: string;
  count?: number;
};

export type AdminAnalyticsKpi = {
  id: string;
  label: string;
  value: number | string;
  helper?: string;
  delta?: number;
  tone?: "positive" | "neutral" | "warning" | "critical";
};

export type AdminAnalyticsUserSummary = {
  id?: string;
  userId?: string;
  username: string;
  displayName?: string;
  email?: string;
  eventCount: number;
  sessionCount?: number;
  lastSeenAt?: string;
  topPolicy?: string;
  topModule?: string;
};

export type AdminAnalyticsPathStep = {
  id: string;
  timestamp?: string;
  at?: string;
  label?: string;
  eventType?: string;
  type?: string;
  policyId?: string;
  policyLabel?: string;
  moduleId?: string;
  moduleLabel?: string;
  routePath?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

export type UserBehaviorAnalyticsData = {
  kpis?: AdminAnalyticsKpi[];
  trend?: AnalyticsTrendPoint[];
  topPolicies?: AnalyticsRankedMetric[];
  moduleDistribution?: AnalyticsDistributionMetric[];
  eventDistribution?: AnalyticsDistributionMetric[];
  users?: AdminAnalyticsUserSummary[];
  userPaths?: Record<string, AdminAnalyticsPathStep[]>;
};

export type UserBehaviorAnalyticsViewProps = {
  data?: UserBehaviorAnalyticsData;
  loadAnalytics?: (filters: AdminAnalyticsFilters) => Promise<UserBehaviorAnalyticsData>;
  loadUserPath?: (userId: string, filters: AdminAnalyticsFilters) => Promise<AdminAnalyticsPathStep[]>;
  loading?: boolean;
  error?: string;
  initialFilters?: Partial<AdminAnalyticsFilters>;
  onFiltersChange?: (filters: AdminAnalyticsFilters) => void;
  policyOptions?: AdminAnalyticsFilterOption[];
  moduleOptions?: AdminAnalyticsFilterOption[];
  eventTypeOptions?: AdminAnalyticsFilterOption[];
  userOptions?: AdminAnalyticsFilterOption[];
  currentUser?: AdminAccessGuardUser | null;
  canAccess?: boolean;
  accessLoading?: boolean;
  allowedRoles?: string[];
  allowedEmails?: string[];
};

type UserPathLoadStatus = {
  loading: boolean;
  error: string;
};

const TIME_RANGE_OPTIONS: Array<{ value: AdminAnalyticsTimeRange; label: string }> = [
  { value: "24h", label: "近 24 小时" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "90d", label: "近 90 天" },
  { value: "custom", label: "自定义" }
];

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function createFilters(initialFilters?: Partial<AdminAnalyticsFilters>): AdminAnalyticsFilters {
  return {
    timeRange: initialFilters?.timeRange ?? "7d",
    from: initialFilters?.from,
    to: initialFilters?.to,
    policyId: initialFilters?.policyId,
    moduleId: initialFilters?.moduleId,
    eventType: initialFilters?.eventType,
    username: initialFilters?.username
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatKpiValue(value: AdminAnalyticsKpi["value"]) {
  return typeof value === "number" ? formatNumber(value) : value;
}

function formatDelta(delta: number) {
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${delta.toFixed(Math.abs(delta) >= 10 ? 0 : 1)}%`;
}

function formatDateTime(value: string | undefined) {
  if (!value) return "未知时间";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDuration(value: number | undefined) {
  if (!Number.isFinite(value)) return "";
  const seconds = Math.max(0, Math.round(Number(value) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getUserId(user: AdminAnalyticsUserSummary) {
  return user.id || user.userId || user.username;
}

function getUserLabel(user: AdminAnalyticsUserSummary) {
  return user.displayName?.trim() || user.username || user.email || getUserId(user);
}

function optionKey(option: AdminAnalyticsFilterOption) {
  return normalize(option.value) || normalize(option.label);
}

function mergeOptions(provided: AdminAnalyticsFilterOption[] | undefined, derived: AdminAnalyticsFilterOption[]) {
  const map = new Map<string, AdminAnalyticsFilterOption>();

  [...(provided ?? []), ...derived].forEach((option) => {
    const key = optionKey(option);
    if (!key || map.has(key)) return;
    map.set(key, option);
  });

  return Array.from(map.values());
}

function metricsToOptions(items: Array<AnalyticsRankedMetric | AnalyticsDistributionMetric> | undefined) {
  return (items ?? []).map((item) => ({
    value: item.id || item.label,
    label: item.label,
    count: item.value
  }));
}

function usersToOptions(items: AdminAnalyticsUserSummary[] | undefined) {
  return (items ?? []).map((user) => ({
    value: user.username || getUserId(user),
    label: getUserLabel(user),
    count: user.eventCount
  }));
}

function stepTime(step: AdminAnalyticsPathStep) {
  return step.timestamp || step.at || "";
}

function stepEventType(step: AdminAnalyticsPathStep) {
  return step.eventType || step.type || "";
}

function matchesValue(filterValue: string | undefined, ...candidates: Array<string | undefined>) {
  const filter = normalize(filterValue);
  if (!filter) return true;

  return candidates.some((candidate) => {
    const value = normalize(candidate);
    return value === filter || value.includes(filter);
  });
}

function parseDate(value: string | undefined, endOfDay = false) {
  if (!value) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  if (value.length <= 10) {
    date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  }

  return date;
}

function rangeStart(timeRange: AdminAnalyticsTimeRange) {
  const now = Date.now();
  if (timeRange === "24h") return new Date(now - 24 * 60 * 60 * 1000);
  if (timeRange === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (timeRange === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000);
  if (timeRange === "90d") return new Date(now - 90 * 24 * 60 * 60 * 1000);
  return undefined;
}

function matchesTimeFilter(step: AdminAnalyticsPathStep, filters: AdminAnalyticsFilters) {
  const rawTime = stepTime(step);
  if (!rawTime) return true;

  const date = new Date(rawTime);
  if (Number.isNaN(date.getTime())) return true;

  if (filters.timeRange === "custom") {
    const from = parseDate(filters.from);
    const to = parseDate(filters.to, true);
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  }

  const from = rangeStart(filters.timeRange);
  return from ? date >= from : true;
}

function matchesPathStep(step: AdminAnalyticsPathStep, filters: AdminAnalyticsFilters) {
  return (
    matchesTimeFilter(step, filters) &&
    matchesValue(filters.policyId, step.policyId, step.policyLabel) &&
    matchesValue(filters.moduleId, step.moduleId, step.moduleLabel) &&
    matchesValue(filters.eventType, stepEventType(step))
  );
}

function userMatchesFilter(user: AdminAnalyticsUserSummary, filters: AdminAnalyticsFilters, path: AdminAnalyticsPathStep[] | undefined) {
  if (!matchesValue(filters.username, user.username, user.displayName, user.email, getUserId(user))) return false;

  const hasPathFilter =
    Boolean(filters.policyId || filters.moduleId || filters.eventType) ||
    filters.timeRange !== "7d" ||
    Boolean(filters.from || filters.to);

  if (!hasPathFilter || !path) return true;
  return path.some((step) => matchesPathStep(step, filters));
}

function normalizeData(data: UserBehaviorAnalyticsData | undefined) {
  return {
    kpis: data?.kpis ?? [],
    trend: data?.trend ?? [],
    topPolicies: data?.topPolicies ?? [],
    moduleDistribution: data?.moduleDistribution ?? [],
    eventDistribution: data?.eventDistribution ?? [],
    users: data?.users ?? [],
    userPaths: data?.userPaths ?? {}
  };
}

function hasUserPath(paths: Record<string, AdminAnalyticsPathStep[]>, userId: string) {
  return Object.prototype.hasOwnProperty.call(paths, userId);
}

function KpiGrid({ kpis }: { kpis: AdminAnalyticsKpi[] }) {
  if (kpis.length === 0) {
    return (
      <section className="admin-analytics-kpis" aria-label="关键指标">
        <div className="admin-analytics-empty" role="status">
          暂无 KPI 数据
        </div>
      </section>
    );
  }

  return (
    <section className="admin-analytics-kpis" aria-label="关键指标">
      {kpis.map((kpi) => (
        <article className={cx("admin-analytics-kpi", kpi.tone && `admin-analytics-kpi-${kpi.tone}`)} key={kpi.id || kpi.label}>
          <span className="admin-analytics-kpi-label">{kpi.label}</span>
          <strong className="admin-analytics-kpi-value">{formatKpiValue(kpi.value)}</strong>
          <div className="admin-analytics-kpi-meta">
            {typeof kpi.delta === "number" && (
              <span className={cx("admin-analytics-kpi-delta", kpi.delta >= 0 ? "admin-analytics-kpi-delta-up" : "admin-analytics-kpi-delta-down")}>
                {formatDelta(kpi.delta)}
              </span>
            )}
            {kpi.helper && <span className="admin-analytics-kpi-helper">{kpi.helper}</span>}
          </div>
        </article>
      ))}
    </section>
  );
}

function UserList({
  users,
  selectedUserId,
  onSelectUser
}: {
  users: AdminAnalyticsUserSummary[];
  selectedUserId: string;
  onSelectUser: (userId: string) => void;
}) {
  return (
    <section className="admin-analytics-users" aria-label="用户列表">
      <div className="admin-analytics-section-head">
        <h2 className="admin-analytics-section-title">用户列表</h2>
        <span className="admin-analytics-section-count">{users.length} 人</span>
      </div>
      {users.length === 0 ? (
        <div className="admin-analytics-empty" role="status">
          暂无匹配用户
        </div>
      ) : (
        <div className="admin-analytics-table-wrap">
          <table className="admin-analytics-user-table">
            <thead>
              <tr>
                <th scope="col">用户</th>
                <th scope="col">事件</th>
                <th scope="col">会话</th>
                <th scope="col">最近访问</th>
                <th scope="col">Top 政策</th>
                <th scope="col">Top 模块</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const userId = getUserId(user);
                const selected = userId === selectedUserId;

                return (
                  <tr key={userId} className={cx("admin-analytics-user-row", selected && "admin-analytics-user-row-active")}>
                    <td>
                      <button
                        type="button"
                        className="admin-analytics-user-button"
                        onClick={() => onSelectUser(userId)}
                        aria-pressed={selected}
                      >
                        <span className="admin-analytics-user-name">{getUserLabel(user)}</span>
                        {user.email && <span className="admin-analytics-user-email">{user.email}</span>}
                      </button>
                    </td>
                    <td>{formatNumber(user.eventCount)}</td>
                    <td>{typeof user.sessionCount === "number" ? formatNumber(user.sessionCount) : "-"}</td>
                    <td>{formatDateTime(user.lastSeenAt)}</td>
                    <td>{user.topPolicy || "-"}</td>
                    <td>{user.topModule || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UserPath({
  users,
  selectedUserId,
  onSelectUser,
  steps,
  loading,
  error
}: {
  users: AdminAnalyticsUserSummary[];
  selectedUserId: string;
  onSelectUser: (userId: string) => void;
  steps: AdminAnalyticsPathStep[];
  loading?: boolean;
  error?: string;
}) {
  const selectedUser = users.find((user) => getUserId(user) === selectedUserId);

  return (
    <section className="admin-analytics-path" aria-label="单用户路径">
      <div className="admin-analytics-section-head">
        <div className="admin-analytics-section-copy">
          <h2 className="admin-analytics-section-title">单用户路径</h2>
          <p className="admin-analytics-section-note">{selectedUser ? getUserLabel(selectedUser) : "请选择用户"}</p>
        </div>
        <select
          className="admin-analytics-path-select"
          value={selectedUserId}
          onChange={(event) => onSelectUser(event.target.value)}
          aria-label="选择用户路径"
          disabled={users.length === 0}
        >
          {users.map((user) => (
            <option key={getUserId(user)} value={getUserId(user)}>
              {getUserLabel(user)}
            </option>
          ))}
        </select>
      </div>
      {loading && (
        <div className="admin-analytics-empty" role="status" aria-live="polite">
          正在加载该用户路径...
        </div>
      )}
      {!loading && error && (
        <div className="admin-analytics-error" role="alert">
          路径加载失败：{error}
        </div>
      )}
      {!loading && !error && steps.length === 0 ? (
        <div className="admin-analytics-empty" role="status">
          暂无该用户路径
        </div>
      ) : null}
      {!loading && !error && steps.length > 0 && (
        <ol className="admin-analytics-path-list">
          {steps.map((step, index) => {
            const eventType = stepEventType(step);
            const duration = formatDuration(step.durationMs);

            return (
              <li className="admin-analytics-path-step" key={step.id || `${stepTime(step)}-${index}`}>
                <time className="admin-analytics-path-time" dateTime={stepTime(step)}>
                  {formatDateTime(stepTime(step))}
                </time>
                <div className="admin-analytics-path-body">
                  <strong className="admin-analytics-path-label">{step.label || eventType || "未知事件"}</strong>
                  <div className="admin-analytics-path-meta">
                    {eventType && <span className="admin-analytics-path-pill">{eventType}</span>}
                    {step.policyLabel && <span className="admin-analytics-path-pill">{step.policyLabel}</span>}
                    {step.moduleLabel && <span className="admin-analytics-path-pill">{step.moduleLabel}</span>}
                    {duration && <span className="admin-analytics-path-pill">{duration}</span>}
                  </div>
                  {step.routePath && <p className="admin-analytics-path-route">{step.routePath}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function UserBehaviorAnalyticsView({
  data,
  loadAnalytics,
  loadUserPath,
  loading = false,
  error,
  initialFilters,
  onFiltersChange,
  policyOptions,
  moduleOptions,
  eventTypeOptions,
  userOptions,
  currentUser,
  canAccess,
  accessLoading,
  allowedRoles,
  allowedEmails
}: UserBehaviorAnalyticsViewProps) {
  const userDatalistId = `${useId()}-admin-analytics-users`;
  const guardAllowed = canAccess === true;
  const [filters, setFilters] = useState<AdminAnalyticsFilters>(() => createFilters(initialFilters));
  const [loadedData, setLoadedData] = useState<UserBehaviorAnalyticsData | undefined>();
  const [loadError, setLoadError] = useState("");
  const [internalLoading, setInternalLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [lazyUserPaths, setLazyUserPaths] = useState<Record<string, AdminAnalyticsPathStep[]>>({});
  const [pathLoadStatus, setPathLoadStatus] = useState<Record<string, UserPathLoadStatus>>({});
  const activeData = useMemo(() => normalizeData(data ?? loadedData), [data, loadedData]);
  const allUserPaths = useMemo(
    () => ({
      ...activeData.userPaths,
      ...lazyUserPaths
    }),
    [activeData.userPaths, lazyUserPaths]
  );

  useEffect(() => {
    onFiltersChange?.(filters);
  }, [filters, onFiltersChange]);

  useEffect(() => {
    setLazyUserPaths({});
    setPathLoadStatus({});
  }, [filters]);

  useEffect(() => {
    if (!loadAnalytics || !guardAllowed) {
      setInternalLoading(false);
      return undefined;
    }

    let active = true;
    setInternalLoading(true);
    setLoadError("");

    loadAnalytics(filters)
      .then((nextData) => {
        if (active) setLoadedData(nextData);
      })
      .catch((nextError: unknown) => {
        if (!active) return;
        setLoadError(nextError instanceof Error ? nextError.message : "加载用户行为数据失败");
      })
      .finally(() => {
        if (active) setInternalLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, guardAllowed, loadAnalytics]);

  const mergedPolicyOptions = useMemo(
    () => mergeOptions(policyOptions, metricsToOptions(activeData.topPolicies)),
    [activeData.topPolicies, policyOptions]
  );
  const mergedModuleOptions = useMemo(
    () => mergeOptions(moduleOptions, metricsToOptions(activeData.moduleDistribution)),
    [activeData.moduleDistribution, moduleOptions]
  );
  const mergedEventTypeOptions = useMemo(
    () => mergeOptions(eventTypeOptions, metricsToOptions(activeData.eventDistribution)),
    [activeData.eventDistribution, eventTypeOptions]
  );
  const mergedUserOptions = useMemo(() => mergeOptions(userOptions, usersToOptions(activeData.users)), [activeData.users, userOptions]);

  const visibleUsers = useMemo(
    () => activeData.users.filter((user) => userMatchesFilter(user, filters, allUserPaths[getUserId(user)])),
    [activeData.users, allUserPaths, filters]
  );

  useEffect(() => {
    if (visibleUsers.length === 0) {
      if (selectedUserId) setSelectedUserId("");
      return;
    }

    if (!visibleUsers.some((user) => getUserId(user) === selectedUserId)) {
      setSelectedUserId(getUserId(visibleUsers[0]));
    }
  }, [selectedUserId, visibleUsers]);

  useEffect(() => {
    if (!guardAllowed || !selectedUserId || !loadUserPath) return undefined;
    if (hasUserPath(activeData.userPaths, selectedUserId) || hasUserPath(lazyUserPaths, selectedUserId)) return undefined;
    if (pathLoadStatus[selectedUserId]) return undefined;

    let active = true;
    setPathLoadStatus((current) => ({
      ...current,
      [selectedUserId]: { loading: true, error: "" }
    }));

    loadUserPath(selectedUserId, filters)
      .then((steps) => {
        if (!active) return;
        setLazyUserPaths((current) => ({
          ...current,
          [selectedUserId]: Array.isArray(steps) ? steps : []
        }));
        setPathLoadStatus((current) => ({
          ...current,
          [selectedUserId]: { loading: false, error: "" }
        }));
      })
      .catch((nextError: unknown) => {
        if (!active) return;
        setPathLoadStatus((current) => ({
          ...current,
          [selectedUserId]: {
            loading: false,
            error: nextError instanceof Error ? nextError.message : "加载用户路径失败"
          }
        }));
      });

    return () => {
      active = false;
    };
  }, [activeData.userPaths, filters, guardAllowed, lazyUserPaths, loadUserPath, selectedUserId]);

  const selectedPath = useMemo(() => {
    if (!selectedUserId) return [];
    return (allUserPaths[selectedUserId] ?? []).filter((step) => matchesPathStep(step, filters));
  }, [allUserPaths, filters, selectedUserId]);

  function updateFilter<Key extends keyof AdminAnalyticsFilters>(key: Key, value: AdminAnalyticsFilters[Key]) {
    setFilters((current) => ({
      ...current,
      [key]: typeof value === "string" && value.trim() === "" ? undefined : value
    }));
  }

  function resetFilters() {
    setFilters(createFilters(initialFilters));
    setLoadedData(undefined);
    setSelectedUserId("");
    setLazyUserPaths({});
    setPathLoadStatus({});
  }

  function selectUser(userId: string) {
    setSelectedUserId(userId);
    setPathLoadStatus((current) => {
      if (!current[userId]?.error) return current;

      const next = { ...current };
      delete next[userId];
      return next;
    });
  }

  const busy = loading || internalLoading;
  const activeError = error || loadError;
  const selectedPathStatus = selectedUserId ? pathLoadStatus[selectedUserId] : undefined;

  return (
    <AdminAccessGuard
      user={currentUser}
      isAllowed={guardAllowed}
      loading={accessLoading}
      allowedRoles={allowedRoles}
      allowedEmails={allowedEmails}
    >
      <main className="admin-analytics-view">
        <header className="admin-analytics-header">
          <div className="admin-analytics-heading">
            <p className="admin-analytics-eyebrow">管理分析</p>
            <h1 className="admin-analytics-title">用户行为分析</h1>
          </div>
          <button type="button" className="admin-analytics-reset-button" onClick={resetFilters}>
            重置筛选
          </button>
        </header>

        <form className="admin-analytics-filters" aria-label="行为分析筛选" onSubmit={(event) => event.preventDefault()}>
          <label className="admin-analytics-filter">
            <span className="admin-analytics-filter-label">时间范围</span>
            <select
              className="admin-analytics-filter-control"
              value={filters.timeRange}
              onChange={(event) => updateFilter("timeRange", event.target.value as AdminAnalyticsTimeRange)}
            >
              {TIME_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {filters.timeRange === "custom" && (
            <>
              <label className="admin-analytics-filter">
                <span className="admin-analytics-filter-label">开始日期</span>
                <input
                  className="admin-analytics-filter-control"
                  type="date"
                  value={filters.from ?? ""}
                  onChange={(event) => updateFilter("from", event.target.value)}
                />
              </label>
              <label className="admin-analytics-filter">
                <span className="admin-analytics-filter-label">结束日期</span>
                <input
                  className="admin-analytics-filter-control"
                  type="date"
                  value={filters.to ?? ""}
                  onChange={(event) => updateFilter("to", event.target.value)}
                />
              </label>
            </>
          )}

          <label className="admin-analytics-filter">
            <span className="admin-analytics-filter-label">政策</span>
            <select
              className="admin-analytics-filter-control"
              value={filters.policyId ?? ""}
              onChange={(event) => updateFilter("policyId", event.target.value)}
            >
              <option value="">全部政策</option>
              {mergedPolicyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-analytics-filter">
            <span className="admin-analytics-filter-label">模块</span>
            <select
              className="admin-analytics-filter-control"
              value={filters.moduleId ?? ""}
              onChange={(event) => updateFilter("moduleId", event.target.value)}
            >
              <option value="">全部模块</option>
              {mergedModuleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-analytics-filter">
            <span className="admin-analytics-filter-label">事件类型</span>
            <select
              className="admin-analytics-filter-control"
              value={filters.eventType ?? ""}
              onChange={(event) => updateFilter("eventType", event.target.value)}
            >
              <option value="">全部事件</option>
              {mergedEventTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-analytics-filter">
            <span className="admin-analytics-filter-label">用户名</span>
            <input
              className="admin-analytics-filter-control"
              type="search"
              list={userDatalistId}
              value={filters.username ?? ""}
              placeholder="输入用户名或邮箱"
              onChange={(event) => updateFilter("username", event.target.value)}
            />
            <datalist id={userDatalistId}>
              {mergedUserOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </datalist>
          </label>
        </form>

        {busy && (
          <p className="admin-analytics-status" role="status" aria-live="polite">
            正在加载用户行为数据...
          </p>
        )}
        {activeError && (
          <p className="admin-analytics-error" role="alert">
            {activeError}
          </p>
        )}

        <KpiGrid kpis={activeData.kpis} />
        <AnalyticsCharts
          trend={activeData.trend}
          topPolicies={activeData.topPolicies}
          moduleDistribution={activeData.moduleDistribution}
          eventDistribution={activeData.eventDistribution}
        />

        <div className="admin-analytics-detail-grid">
          <UserList users={visibleUsers} selectedUserId={selectedUserId} onSelectUser={selectUser} />
          <UserPath
            users={visibleUsers}
            selectedUserId={selectedUserId}
            onSelectUser={selectUser}
            steps={selectedPath}
            loading={selectedPathStatus?.loading}
            error={selectedPathStatus?.error}
          />
        </div>
      </main>
    </AdminAccessGuard>
  );
}
