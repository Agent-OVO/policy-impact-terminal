import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpenText,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Command,
  Clock,
  Database,
  Download,
  ExternalLink,
  Expand,
  FileText,
  GitCompareArrows,
  Globe2,
  Home,
  Layers3,
  LockKeyhole,
  LogOut,
  Menu,
  Network,
  PanelLeftClose,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  UserBehaviorAnalyticsView,
  type AdminAnalyticsFilters as AdminViewFilters,
  type AdminAnalyticsPathStep,
  type UserBehaviorAnalyticsData
} from "./components/admin";
import { CompaniesView, CompanyCard, CompanyMatrix } from "./components/company";
import {
  actions,
  backgroundCards,
  chainEdges,
  chainNodes,
  clauses,
  clauseGroups,
  companies,
  compareRows,
  evidence,
  policy,
  type ChainNode,
  type Company,
  type CompareInsightRow,
  type ModuleId,
  type RelationType
} from "./data/policy";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { getAnalyticsSessionId, trackUserEvent, type TrackUserEventInput } from "./lib/analytics";
import { loadCurrentUserAccess } from "./lib/adminAccess";
import {
  fetchAdminBehaviorDetail,
  fetchAdminBehaviorList,
  fetchAdminBehaviorOverview
} from "./lib/adminAnalytics";
import { formatSourceTypeLabel } from "./lib/reportMappers";
import {
  getPolicyReport,
  getReportRepositoryMode,
  listPolicyReports,
  type AnalysisJob,
  type JobStatus,
  type PolicyReport,
  type PolicySummary,
  type ReportStatus
} from "./lib/reportRepository";
import type {
  AdminBehaviorDetail,
  AdminBehaviorFilters,
  AdminBehaviorListResult,
  AdminBehaviorOverview,
  AdminBehaviorTimelineItem,
  CurrentUserAccess
} from "./types/analytics";
import {
  formatAdminDuration,
  formatAdminEventType,
  formatAdminModuleId,
  formatAdminNumber
} from "./types/analytics";

const sectionLabels: Record<ChainNode["section"], string> = {
  upstream: "上游基础",
  midstream: "中游平台",
  downstream: "下游应用",
  support: "配套保障"
};

const sectionOrder: ChainNode["section"][] = ["upstream", "midstream", "downstream", "support"];

const relationClass: Record<RelationType, string> = {
  直接相关: "positive",
  间接相关: "neutral",
  潜在受益: "warm",
  约束风险: "risk",
  待验证: "pending"
};

type SessionUser = {
  id?: string;
  email: string;
  name: string;
};

type AppView = "list" | "report" | "adminAnalytics";
type PolicyMetaWithExtras = typeof policy & {
  sourceUrl?: string;
  source_url?: string;
  scope?: string;
  impactScope?: string;
  jurisdiction?: string;
  tags?: string[];
};

type TimelineFilter = "all" | "policy" | "evidence" | "analysis";
type RepositoryMode = "mock" | "supabase" | "unavailable";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const EMPTY_ADMIN_ACCESS: CurrentUserAccess = {
  userId: "",
  role: "unknown",
  status: "unknown",
  isActive: false,
  isAdmin: false,
  canAccessAdmin: false
};

function percent(value: number) {
  return `${Math.round(value)}%`;
}

function compactText(value: string, maxLength = 78) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function formatDateLabel(value?: string) {
  if (!value) return "待补充";
  return value.replace(/-/g, ".");
}

function getPolicySourceUrl(currentPolicy: typeof policy, fallback = "") {
  const extra = currentPolicy as PolicyMetaWithExtras;
  return extra.sourceUrl || extra.source_url || fallback;
}

function getPolicyTags(currentPolicy: typeof policy) {
  const extra = currentPolicy as PolicyMetaWithExtras;
  return Array.isArray(extra.tags) ? extra.tags.filter(Boolean) : [];
}

function inferPolicyScope(currentPolicy: typeof policy) {
  const extra = currentPolicy as PolicyMetaWithExtras;
  if (extra.scope || extra.impactScope || extra.jurisdiction) {
    return extra.scope || extra.impactScope || extra.jurisdiction || "以发布机关管辖范围为准";
  }

  const text = `${currentPolicy.title} ${currentPolicy.issuer} ${currentPolicy.level} ${currentPolicy.source}`;
  const provinceMatch = text.match(/(北京市|天津市|上海市|重庆市|河北省|山西省|辽宁省|吉林省|黑龙江省|江苏省|浙江省|安徽省|福建省|江西省|山东省|河南省|湖北省|湖南省|广东省|海南省|四川省|贵州省|云南省|陕西省|甘肃省|青海省|台湾省|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|香港特别行政区|澳门特别行政区)/);
  if (provinceMatch) return provinceMatch[1];
  if (/国务院|中共中央|全国|国家|中国政府网|国家发展改革委|国家数据局|工业和信息化部|部委/.test(text)) return "全国";
  return "以政策发布机关管辖范围为准";
}

function buildFilename(value: string, suffix: string) {
  const safe = value.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").slice(0, 40) || "policy-report";
  return `${safe}-${suffix}.txt`;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getNode(id: string, nodes: ChainNode[] = chainNodes) {
  return nodes.find((node) => node.id === id);
}

function getCompany(id: string, items: Company[] = companies) {
  return items.find((company) => company.id === id);
}

const USERNAME_AUTH_DOMAIN = "users.policy-impact-terminal.invalid";

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function isValidUsername(value: string) {
  return /^[a-z0-9_-]{3,32}$/.test(value);
}

function usernameToAuthEmail(value: string) {
  return `${normalizeUsername(value)}@${USERNAME_AUTH_DOMAIN}`;
}

function AuthScreen({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState(() => (isSupabaseConfigured ? "" : "researcher"));
  const [password, setPassword] = useState(() => (isSupabaseConfigured ? "" : "demo123456"));
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured && mode === "register") setMode("login");
  }, [mode]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      if (isSupabaseConfigured && supabase) {
        const normalizedUsername = normalizeUsername(username);

        if (!isValidUsername(normalizedUsername)) {
          setMessage("用户名需为 3-32 位小写字母、数字、下划线或短横线。");
          return;
        }

        if (mode === "register" && password !== confirmPassword) {
          setMessage("两次输入的密码不一致。");
          return;
        }

        const authEmail = usernameToAuthEmail(normalizedUsername);
        const response =
          mode === "login"
            ? await supabase.auth.signInWithPassword({ email: authEmail, password })
            : await supabase.auth.signUp({
                email: authEmail,
                password,
                options: {
                  data: {
                    name: normalizedUsername,
                    username: normalizedUsername
                  }
                }
              });

        if (response.error) {
          setMessage(response.error.message);
          return;
        }

        if (response.data.session?.user) {
          onLogin(toSessionUser(response.data.session.user));
          return;
        }

        setMessage(mode === "register" ? "账号已创建，请直接登录。" : "登录失败，请重新输入。");
        return;
      }

      onLogin({ email: username, name: "研究员" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-lockup auth-brand">
          <div className="brand-mark">P</div>
          <div>
            <strong>政策产业影响终端</strong>
            <span>登录后访问政策分析报表</span>
          </div>
        </div>

        <div className="auth-hero">
          <p className="eyebrow">政策智能分析终端</p>
          <h1>政策原文驱动的产业影响分析终端</h1>
          <p>普通用户注册后即可查看已发布报表，政策抓取和分析由后台定时完成。</p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="auth-switch">
            <button type="button" className={cx(mode === "login" && "active")} onClick={() => setMode("login")}>
              登录
            </button>
            {isSupabaseConfigured && (
              <button type="button" className={cx(mode === "register" && "active")} onClick={() => setMode("register")}>
                注册
              </button>
            )}
          </div>

          <label>
            <span>用户名</span>
            <div className="input-shell">
              <UserRound size={16} />
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                type="text"
                autoComplete="username"
                pattern="[A-Za-z0-9_\-]{3,32}"
                required
              />
            </div>
          </label>

          <label>
            <span>密码</span>
            <div className="input-shell">
              <LockKeyhole size={16} />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={6}
                required
              />
            </div>
          </label>

          {mode === "register" && (
            <label>
              <span>确认密码</span>
              <div className="input-shell">
                <LockKeyhole size={16} />
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>
            </label>
          )}

          {message && <p className="auth-error">{message}</p>}
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "正在验证..." : mode === "login" ? "进入终端" : "创建账号"}
            <ChevronRight size={16} />
          </button>
          <p className="auth-note">
            {isSupabaseConfigured
              ? "注册无需邮箱确认；账号仅用于访问已发布政策分析。"
              : "当前未配置 Supabase，使用本地演示会话。"}
          </p>
        </form>
      </section>

      <section className="auth-preview">
        <div className="preview-orbit" />
        <div className="mini-report">
          <span>政策分析已发布</span>
          <strong>定时抓取政策原文，人工生成产业影响报告</strong>
          <div className="mini-lines">
            <i />
            <i />
            <i />
          </div>
        </div>
      </section>
    </main>
  );
}

function TopBar({
  user,
  onLogout,
  reports,
  onOpenReport,
  repositoryMode,
  activeView,
  canOpenAdmin,
  adminAccessLoading,
  onOpenAdminAnalytics
}: {
  user: SessionUser;
  onLogout: () => void;
  reports: PolicySummary[];
  onOpenReport: (reportId: string) => void;
  repositoryMode: RepositoryMode;
  activeView: AppView;
  canOpenAdmin: boolean;
  adminAccessLoading: boolean;
  onOpenAdminAnalytics: () => void;
}) {
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userInitial = (user.name || user.email || "用").slice(0, 1).toUpperCase();
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchMatches = normalizedSearch
    ? reports
        .filter((item) =>
          [item.title, item.issuer, item.source, item.primarySignal]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        )
        .slice(0, 6)
    : [];
  const monitorLabel = repositoryMode === "supabase" ? "定时抓取" : repositoryMode === "mock" ? "本地演示" : "未配置";
  const monitorStatus = repositoryMode === "supabase" ? "已连接" : repositoryMode === "mock" ? "未连云端" : "需配置";
  const monitorCount = repositoryMode === "supabase" ? `${reports.length}篇` : repositoryMode === "mock" ? "演示" : "0篇";

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setNoticeOpen(false);
      setProfileOpen(false);
    }

    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    function focusSearch(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      searchInputRef.current?.focus();
    }

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function openSearchResult(reportId: string) {
    setSearchQuery("");
    onOpenReport(reportId);
  }

  function submitGlobalSearch(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || searchMatches.length === 0) return;
    event.preventDefault();
    openSearchResult(searchMatches[0].id);
  }

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark">P</div>
        <strong>政策产业影响终端</strong>
      </div>
      <div className="monitor-pill">
        <span className="pulse-dot" />
        <span>{monitorLabel}</span>
        <b>{monitorStatus}</b>
        <em>{monitorCount}</em>
      </div>
      <div className="global-search">
        <Search size={17} />
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={submitGlobalSearch}
          placeholder="搜索已发布政策标题、来源或产业方向"
          aria-label="全局搜索政策报表"
        />
        <span>
          Ctrl / <Command size={13} /> + K
        </span>
        {normalizedSearch && (
          <div className="global-search-results" role="listbox" aria-label="政策搜索结果">
            {searchMatches.length === 0 ? (
              <p>没有匹配的已发布政策。</p>
            ) : (
              searchMatches.map((item) => (
                <button key={item.id} type="button" onClick={() => openSearchResult(item.id)}>
                  <strong>{item.title}</strong>
                  <small>{item.issuer} · {item.source} · {item.publishDate || "日期待补充"}</small>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div className="top-actions" ref={menuRef}>
        {canOpenAdmin && (
          <button
            className={cx("icon-button quiet", activeView === "adminAnalytics" && "active")}
            type="button"
            aria-label="用户行为分析"
            title="用户行为分析"
            onClick={() => {
              onOpenAdminAnalytics();
              setNoticeOpen(false);
              setProfileOpen(false);
            }}
          >
            <BarChart3 size={18} />
          </button>
        )}
        {!canOpenAdmin && adminAccessLoading && (
          <span className="topbar-admin-loading" aria-label="正在校验管理员权限" />
        )}
        <div className="top-action-menu">
          <button
            className="icon-button"
            aria-label="通知"
            aria-expanded={noticeOpen}
            onClick={() => {
              setNoticeOpen((value) => !value);
              setProfileOpen(false);
            }}
          >
            <Bell size={20} />
          </button>
          {noticeOpen && (
            <div className="top-popover notice-popover">
              <strong>系统通知</strong>
              <p>当前为只读工作台。政策由后台定时抓取，分析由 Codex 手动审核后发布。</p>
              <p>暂无新的个人通知。</p>
            </div>
          )}
        </div>
        <button
          className="user-chip"
          type="button"
          aria-expanded={profileOpen}
          onClick={() => {
            setProfileOpen((value) => !value);
            setNoticeOpen(false);
          }}
        >
          <div className="avatar">{userInitial}</div>
          <span>{user.name}</span>
          <ChevronDown size={14} />
        </button>
        {profileOpen && (
          <div className="top-popover profile-popover">
            <strong>{user.name}</strong>
            <p>{user.email}</p>
            {canOpenAdmin && (
              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  onOpenAdminAnalytics();
                }}
              >
                <BarChart3 size={15} />
                用户行为分析
              </button>
            )}
            <button type="button" onClick={onLogout}>
              <LogOut size={15} />
              退出登录
            </button>
          </div>
        )}
        <button className="icon-button quiet" onClick={onLogout} aria-label="退出登录">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

function PolicySidebar({
  activeModule,
  setActiveModule,
  collapsed,
  setCollapsed,
  onBackToList,
  report
}: {
  activeModule: ModuleId;
  setActiveModule: (module: ModuleId) => void;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  onBackToList: () => void;
  report: PolicyReport | null;
}) {
  const currentPolicy = report?.policy;
  const currentModules = report?.modules ?? [];
  const currentEvidence = report?.evidence ?? [];
  const [starred, setStarred] = useState(false);

  useEffect(() => {
    if (!currentPolicy) return;
    const key = `policy-terminal-starred:${getPolicySourceUrl(currentPolicy, currentPolicy.title) || currentPolicy.title}`;
    setStarred(window.localStorage.getItem(key) === "1");
  }, [currentPolicy]);

  function toggleStarred() {
    if (!currentPolicy) return;
    const key = `policy-terminal-starred:${getPolicySourceUrl(currentPolicy, currentPolicy.title) || currentPolicy.title}`;
    const next = !starred;
    setStarred(next);
    if (next) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  }

  return (
    <aside className={cx("sidebar", collapsed && "collapsed")}>
      <button className="back-link" onClick={onBackToList}>
        <ArrowLeft size={16} />
        返回政策列表
      </button>

      {currentPolicy ? (
        <section className="policy-card">
          <div className="row-between">
            <span className="section-label">当前分析政策</span>
            <span className="status-badge purple">{currentPolicy.status}</span>
          </div>
          <div className="policy-title-row">
            <h2>{currentPolicy.title}</h2>
            <button
              className={cx("star-button", starred && "active")}
              aria-label={starred ? "取消本机标记" : "本机标记当前政策"}
              aria-pressed={starred}
              title={starred ? "已在本机标记" : "本机标记"}
              onClick={toggleStarred}
            >
              <Sparkles size={17} />
            </button>
          </div>
          <dl className="meta-list">
            <div>
              <dt>发布机构</dt>
              <dd>{currentPolicy.issuer}</dd>
            </div>
            <div>
              <dt>发布日期</dt>
              <dd>{currentPolicy.publishDate}</dd>
            </div>
            <div>
              <dt>生效时间</dt>
              <dd>{currentPolicy.effectiveDate}</dd>
            </div>
            <div>
              <dt>来源网站</dt>
              <dd>{currentPolicy.source}</dd>
            </div>
            <div>
              <dt>政策类型</dt>
              <dd>{currentPolicy.category}</dd>
            </div>
            <div>
              <dt>政策层级</dt>
              <dd>{currentPolicy.level}</dd>
            </div>
          </dl>
          <div className="policy-illustration">
            <ShieldCheck size={42} />
          </div>
        </section>
      ) : (
        <section className="policy-card policy-card-empty">
          <span className="section-label">当前分析政策</span>
          <h2>报表未加载</h2>
          <p>请等待数据读取完成，或返回政策列表重新选择报表。</p>
        </section>
      )}

      {currentModules.length > 0 && (
        <nav className="side-nav">
          {currentModules.map((module) => (
            <button
              key={module.id}
              className={cx(activeModule === module.id && "active")}
              onClick={() => setActiveModule(module.id)}
            >
              {module.id === "brief" && <Home size={16} />}
              {module.id === "industry" && <Network size={16} />}
              {module.id === "clauses" && <BookOpenText size={16} />}
              {module.id === "background" && <ClipboardList size={16} />}
              {module.id === "compare" && <GitCompareArrows size={16} />}
              {module.id === "companies" && <Building2 size={16} />}
              {module.id === "evidence" && <FileText size={16} />}
              <span>{module.label}</span>
              {module.badge && <em>{module.badge}</em>}
            </button>
          ))}
        </nav>
      )}

      {currentPolicy && (
        <section className="confidence-card">
          <div className="confidence-summary">
            <span>整体置信度</span>
            <strong>{currentPolicy.confidence}<small>/100</small></strong>
            <b>较高</b>
          </div>
          <div className="confidence-meter">
            <i style={{ width: `${currentPolicy.confidence}%` }} />
          </div>
          <ul>
            <li><span className="dot green" /> 强证据 <b>{currentEvidence.filter((item) => item.confidence >= 85).length}</b></li>
            <li><span className="dot blue" /> 间接证据 <b>{currentEvidence.filter((item) => item.confidence >= 70 && item.confidence < 85).length}</b></li>
            <li><span className="dot orange" /> 待验证 <b>{currentEvidence.filter((item) => item.confidence >= 50 && item.confidence < 70).length}</b></li>
            <li><span className="dot red" /> 弱/风险 <b>{currentEvidence.filter((item) => item.confidence < 50).length}</b></li>
          </ul>
        </section>
      )}

      <button className="collapse-button" onClick={() => setCollapsed(!collapsed)}>
        <PanelLeftClose size={16} />
        {collapsed ? "展开导航" : "收起导航"}
      </button>
    </aside>
  );
}

function ReportHeader({
  activeModule,
  setActiveModule,
  report,
  onRefresh,
  refreshing
}: {
  activeModule: ModuleId;
  setActiveModule: (module: ModuleId) => void;
  report: PolicyReport | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const currentTopTabs = report?.topTabs ?? [];
  const currentModules = report?.modules ?? [];
  const activeOutsideTopTabs = !currentTopTabs.some((tab) => tab.id === activeModule);
  const activeModuleMeta = currentModules.find((module) => module.id === activeModule);
  const visibleTabs = activeOutsideTopTabs && activeModuleMeta ? [...currentTopTabs, activeModuleMeta] : currentTopTabs;

  return (
    <div className="report-header">
      <nav className="top-tabs">
        {visibleTabs.length > 0 ? visibleTabs.map((tab) => (
          <button key={tab.id} className={cx(activeModule === tab.id && "active")} onClick={() => setActiveModule(tab.id)}>
            {tab.label}
          </button>
        )) : (
          <span className="tab-placeholder">报表加载中</span>
        )}
      </nav>
      <div className="update-status">
        <span>数据更新：{report?.generatedAt ? new Date(report.generatedAt).toLocaleString("zh-CN", { hour12: false }) : "读取中"}</span>
        <button type="button" onClick={onRefresh} disabled={refreshing}>
          更新 <RefreshCw size={14} className={cx(refreshing && "spin-icon")} />
        </button>
      </div>
    </div>
  );
}

function Tag({ value, small }: { value: string; small?: boolean }) {
  return <span className={cx("tag", small && "small", relationClass[value as RelationType] || "")}>{value}</span>;
}

function BriefView({
  setActiveModule,
  report
}: {
  setActiveModule: (module: ModuleId) => void;
  report: PolicyReport | null;
}) {
  const currentPolicy = report?.policy ?? policy;
  const currentActions = report?.actions ?? actions;
  const currentClauses = report?.clauses ?? clauses;
  const currentEvidence = report?.evidence ?? evidence;
  const currentChainNodes = report?.chainNodes ?? chainNodes;
  const currentCompanies = report?.companies ?? companies;
  const policySourceUrl = getPolicySourceUrl(currentPolicy);
  const impactScope = inferPolicyScope(currentPolicy);
  const policyTags = getPolicyTags(currentPolicy);
  const quickTake = report?.brief?.judgement ?? "该政策尚未完成人工大模型归纳，请在待分析队列中触发 Codex 分析后查看。";
  const quickItems = report?.brief?.keyPoints?.length
    ? report.brief.keyPoints
    : currentClauses.length
    ? currentClauses.slice(0, 4).map((clause) => `${clause.no || "条款"} ${clause.title || "核心内容"}：${clause.excerpt}`)
    : currentActions.slice(0, 4).map((action) => action.body);
  const kpis = [
    [`${currentClauses.length} 条`, "结构化条款", "来自政策原文分段"],
    [`${currentEvidence.length} 条`, "证据摘录", "可追溯到来源材料"],
    [`${currentChainNodes.length} 个`, "产业影响节点", currentChainNodes.length ? "由政策文本命中生成" : "尚未形成产业映射"],
    [currentCompanies.length ? `${currentCompanies.length} 家` : "未生成", "代表性公司", currentCompanies.length ? "仅服务本政策分析" : "不使用样例公司填充"],
    [`${currentPolicy.confidence}/100`, "整体置信度", policySourceUrl ? "含政策来源链接" : "等待来源链接"]
  ];
  const logicActionItems = currentActions.slice(0, 4).map((action, index) => ({
    id: action.id || `logic-action-${index}`,
    title: action.title || `政策动作 ${index + 1}`,
    body: action.body || "该动作尚未返回解释文本。",
    meta: `信号：${action.signal}`,
    count: `${action.confidence}/100`
  }));
  const logicClauseItems = currentClauses.slice(0, 4).map((clause, index) => {
    const linkedEvidenceCount = currentEvidence.filter((item) => item.clauseIds?.includes(clause.id)).length;
    return {
      id: clause.id || `logic-clause-${index}`,
      title: `${clause.no || `条款${index + 1}`} ${clause.title || "未命名条款"}`,
      body: clause.excerpt || "该条款尚未返回摘录。",
      meta: clause.keywords.slice(0, 3).join(" / ") || "条款依据",
      count: linkedEvidenceCount ? `${linkedEvidenceCount} 证据` : `${clause.confidence}%`
    };
  });
  const logicNodeItems = currentChainNodes.slice(0, 4).map((node, index) => ({
    id: node.id || `logic-node-${index}`,
    title: node.title || `产业节点 ${index + 1}`,
    body: node.description || node.subtitle || "该节点尚未返回影响说明。",
    meta: `${node.relation} · ${node.evidence}`,
    count: `${node.clauses.length} 条款`
  }));
  const logicEvidenceItems = currentEvidence.slice(0, 4).map((item, index) => ({
    id: item.id || `logic-evidence-${index}`,
    title: item.title || `${formatSourceTypeLabel(item.type, "证据")} ${index + 1}`,
    body: item.excerpt || "该证据尚未返回摘录。",
    meta: `${formatSourceTypeLabel(item.type, "证据")} · ${formatSourceTypeLabel(item.source, "未标注来源")}`,
    count: `${item.confidence}%`
  }));
  const logicStages = [
    {
      id: "actions",
      step: "01",
      title: "政策动作",
      summary: `${currentActions.length} 个动作`,
      items: logicActionItems.length
        ? logicActionItems
        : [{ id: "logic-actions-empty", title: "政策原文已入库", body: "等待补充政策动作拆解。", meta: "待分析", count: "0" }]
    },
    {
      id: "clauses",
      step: "02",
      title: "条款依据",
      summary: `${currentClauses.length} 条条款`,
      items: logicClauseItems.length
        ? logicClauseItems
        : [{ id: "logic-clauses-empty", title: "暂无可展示条款", body: "等待条款抽取结果。", meta: "待抽取", count: "0" }]
    },
    {
      id: "nodes",
      step: "03",
      title: "影响节点",
      summary: `${currentChainNodes.length} 个节点`,
      items: logicNodeItems.length
        ? logicNodeItems
        : [{ id: "logic-nodes-empty", title: "尚未形成产业节点", body: policyTags.slice(0, 3).join(" / ") || "等待产业链映射。", meta: "待映射", count: "0" }]
    },
    {
      id: "evidence",
      step: "04",
      title: "证据校验",
      summary: `${currentEvidence.length} 条证据`,
      items: logicEvidenceItems.length
        ? logicEvidenceItems
        : [{ id: "logic-evidence-empty", title: "暂无证据摘录", body: "等待证据链结构化。", meta: "待校验", count: "0" }]
    }
  ];

  return (
    <div className="content-grid brief-grid">
      <section className="panel hero-panel">
        <div>
          <span className="status-badge purple">AI 速读摘要</span>
          <h1>{currentPolicy.title}</h1>
          <div className="judgement">
            <strong>一句话判断</strong>
            <p>{quickTake}</p>
          </div>
          <div className="hero-metrics">
            <Metric icon={Sparkles} label="政策定位" value={currentPolicy.category || "政策文件"} />
            <Metric icon={Network} label="影响范围" value={impactScope} />
            <Metric icon={FileText} label="生效时间" value={currentPolicy.effectiveDate} />
            <Metric icon={Layers3} label="置信度" value={`${currentPolicy.confidence}/100`} />
          </div>
          <div className="source-row">
            <span>来源：{formatSourceTypeLabel(currentPolicy.source, "官方来源")}</span>
            {policySourceUrl ? (
              <a href={policySourceUrl} target="_blank" rel="noreferrer">
                查看政策原文 <ExternalLink size={14} />
              </a>
            ) : (
              <em>暂无来源链接</em>
            )}
          </div>
        </div>
        <div className="summary-visual" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}policy-summary-visual.svg`} alt="" />
        </div>
      </section>

      <section className="panel details-panel quick-read-detail-panel">
        <h2>速读详情</h2>
        <div className="score-inline quick-read-score">
          <div className="ring small-ring" style={{ "--value": `${currentPolicy.confidence}%` } as React.CSSProperties}>
            <strong>{currentPolicy.confidence}</strong>
            <span>/100</span>
          </div>
          <p>基于政策文本完整度、信号明确度、历史一致性等多维度评估，结论较为可靠。</p>
        </div>
        <Accordion title="核心要点速览" items={quickItems.length ? quickItems : ["政策原文已入库，等待后续深度结构化分析。"]} />
        <EvidenceSnippets evidenceItems={currentEvidence} compact />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>关键指标</h2>
          <button className="text-button" onClick={() => setActiveModule("evidence")}>查看证据指标</button>
        </div>
        <div className="kpi-grid">
          {kpis.map(([value, label, note]) => (
            <div className="kpi-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <em>{note}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="panel action-panel">
        <div className="panel-head">
          <h2>政策动作拆解</h2>
          <span className="muted">核心抓手</span>
        </div>
        {currentActions.map((action) => (
          <article className="action-row" key={action.id}>
            <div className={cx("action-icon", relationClass[action.signal as RelationType] || "positive")}>
              <Sparkles size={16} />
            </div>
            <div>
              <strong>{action.title}</strong>
              <p>{action.body}</p>
            </div>
            <Tag value={action.signal} small />
          </article>
        ))}
      </section>

      <section className="panel logic-panel">
        <div className="panel-head">
          <div>
            <h2>政策逻辑图谱</h2>
            <p>按“政策动作 - 条款依据 - 影响节点 - 证据校验”梳理，不再使用固定样例链路。</p>
          </div>
        </div>
        <div className="logic-map logic-board">
          {logicStages.map((stage, index) => (
            <div className="logic-stage-wrap" key={stage.id}>
              <section className={cx("logic-stage", `logic-stage-${stage.id}`)}>
                <div className="logic-stage-head">
                  <span>{stage.step}</span>
                  <div>
                    <strong>{stage.title}</strong>
                    <em>{stage.summary}</em>
                  </div>
                </div>
                <div className="logic-stage-list">
                  {stage.items.map((item) => (
                    <article className="logic-card" key={item.id}>
                      <div className="logic-card-title">
                        <b>{item.title}</b>
                        <span>{item.count}</span>
                      </div>
                      <p>{compactText(item.body, 108)}</p>
                      <small>{item.meta}</small>
                    </article>
                  ))}
                </div>
              </section>
              {index < logicStages.length - 1 && <div className="logic-flow-cue" aria-hidden="true">→</div>}
            </div>
          ))}
        </div>
        <button className="text-button" onClick={() => setActiveModule("industry")}>
          查看产业链影响 <ChevronRight size={16} />
        </button>
      </section>

      <SignalBar actions={currentActions} onShowAll={() => setActiveModule("evidence")} />
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Sparkles; label: string; value: string }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Accordion({ title, items }: { title: string; items: string[] }) {
  const [open, setOpen] = useState(true);

  return (
    <section className="accordion-card">
      <button className="row-between accordion-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <h3>{title}</h3>
        <ChevronDown size={16} className={cx(!open && "rotated")} />
      </button>
      {open && (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EvidenceSnippets({
  compact,
  evidenceItems = evidence
}: {
  compact?: boolean;
  evidenceItems?: typeof evidence;
}) {
  const [expanded, setExpanded] = useState(!compact);
  const limit = compact && !expanded ? 3 : evidenceItems.length;
  const visibleEvidence = evidenceItems.slice(0, limit);
  const canToggle = compact && evidenceItems.length > 3;

  return (
    <section className={cx("evidence-snippets", compact && "compact")}>
      <div className="panel-head flush">
        <h3>关键依据</h3>
        {canToggle && (
          <button className="text-button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起" : "查看更多"}
          </button>
        )}
      </div>
      {visibleEvidence.length === 0 && <p className="empty-note">暂无证据摘录。</p>}
      {visibleEvidence.map((item, index) => (
        <article key={item.id}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <p>“{item.excerpt}”</p>
          <em>{formatSourceTypeLabel(item.type, "证据")} · {formatSourceTypeLabel(item.source, "未标注来源")}</em>
        </article>
      ))}
    </section>
  );
}

function SignalBar({ actions: policyActions = actions, onShowAll }: { actions?: typeof actions; onShowAll?: () => void }) {
  const signalClasses: Record<string, string> = {
    利好: "positive",
    约束: "warm",
    风险: "risk",
    待验证: "pending"
  };
  const signals = ["利好", "约束", "风险", "待验证"].map((label) => [
    label,
    policyActions.filter((action) => action.signal === label).length,
    signalClasses[label]
  ]);

  return (
    <section className="panel signal-bar">
      <h2>政策信号</h2>
      {signals.map(([label, count, klass]) => (
        <span className={String(klass)} key={String(label)}>
          {label} <b>{count}</b>
        </span>
      ))}
      <button className="text-button" onClick={onShowAll}>查看全部信号 <ChevronRight size={16} /></button>
    </section>
  );
}

function IndustryView({
  selectedNodeId,
  setSelectedNodeId,
  setActiveModule,
  report
}: {
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
  setActiveModule: (module: ModuleId) => void;
  report: PolicyReport | null;
}) {
  const currentChainNodes = report ? report.chainNodes : chainNodes;
  const currentChainEdges = report ? report.chainEdges : chainEdges;
  const currentCompanies = report ? report.companies : companies;
  const currentClauses = report ? report.clauses : clauses;
  const selectedNode = getNode(selectedNodeId, currentChainNodes) || currentChainNodes[0];
  const [selectedSnapshotCompanyId, setSelectedSnapshotCompanyId] = useState(currentCompanies[0]?.id ?? "");
  const [mapExpanded, setMapExpanded] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const selectedSnapshotCompany = getCompany(selectedSnapshotCompanyId, currentCompanies) || currentCompanies[0];

  useEffect(() => {
    if (!currentCompanies.some((company) => company.id === selectedSnapshotCompanyId)) {
      setSelectedSnapshotCompanyId(currentCompanies[0]?.id ?? "");
    }
  }, [currentCompanies, selectedSnapshotCompanyId]);

  if (!selectedNode) {
    return (
      <div className="industry-layout">
        <section className="panel industry-panel">
          <div className="panel-head">
            <div>
              <h2>产业链影响地图</h2>
              <p>当前政策尚未生成可用产业节点，系统不会回退展示样例产业链。</p>
            </div>
          </div>
          <p className="empty-note">需要后端分析函数补充产业链节点后才能展示地图。</p>
        </section>
      </div>
    );
  }

  return (
    <div className="industry-layout">
      <section className={cx("panel industry-panel", mapExpanded && "expanded-map")}>
        <div className="panel-head">
          <div>
            <h2>产业链影响地图</h2>
            <p>图例：直接影响 / 间接影响 / 潜在影响 / 约束影响</p>
          </div>
          <div className="toolbar">
            <button type="button" onClick={() => setMapExpanded((value) => !value)}><Expand size={15} /> {mapExpanded ? "退出放大" : "放大地图"}</button>
            <button type="button" onClick={() => setHelpOpen((value) => !value)}><CircleHelp size={15} /> 说明</button>
          </div>
        </div>
        {helpOpen && (
          <div className="inline-help">
            地图只展示当前政策人工分析确认的产业节点；节点越亮表示与当前选择节点关系越近，点击节点可查看对应条款和证据。
          </div>
        )}
        <IndustryMap nodes={currentChainNodes} edges={currentChainEdges} selectedNodeId={selectedNodeId} setSelectedNodeId={setSelectedNodeId} />
        <div className="map-footer">
          <span>当前高亮路径：政策 → {selectedNode.title}</span>
          <button onClick={() => setActiveModule("companies")}>查看代表性公司（{currentCompanies.length}）</button>
        </div>
      </section>

      <NodeDetail node={selectedNode} clauses={currentClauses} companies={currentCompanies} />

      <section className="panel company-snapshot">
        <div className="panel-head">
          <h2>代表性公司影响快照</h2>
          <button className="text-button" onClick={() => setActiveModule("companies")}>
            进入公司影响分析 <ChevronRight size={16} />
          </button>
        </div>
        <CompanyMatrix compact companies={currentCompanies} selectedCompanyId={selectedSnapshotCompanyId} setSelectedCompanyId={setSelectedSnapshotCompanyId} />
        {selectedSnapshotCompany ? (
          <div className="matrix-focus-card">
            <span>{selectedSnapshotCompany.name}</span>
            <strong>{selectedSnapshotCompany.platform}</strong>
            <div>
              <Tag value={selectedSnapshotCompany.relation} small />
              <Tag value={selectedSnapshotCompany.evidence} small />
              <b>{selectedSnapshotCompany.confidence}/100</b>
            </div>
          </div>
        ) : <p className="empty-note">当前报表暂无代表性公司映射。为避免误导，未使用样例公司填充。</p>}
        <div className="company-strip">
          {currentCompanies.slice(0, 5).map((company) => (
            <button
              className={cx("company-strip-button", selectedSnapshotCompanyId === company.id && "active")}
              key={company.id}
              onClick={() => setSelectedSnapshotCompanyId(company.id)}
            >
              <CompanyCard company={company} compact />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function IndustryMap({
  nodes,
  edges,
  selectedNodeId,
  setSelectedNodeId
}: {
  nodes: typeof chainNodes;
  edges: typeof chainEdges;
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
}) {
  const activeEdges = edges.filter((edge) => edge.from === selectedNodeId || edge.to === selectedNodeId);

  return (
    <div className="industry-map">
      <svg className="map-lines" viewBox="0 0 1000 520" preserveAspectRatio="none">
        {edges.map((edge, index) => {
          const from = getNode(edge.from, nodes);
          const to = getNode(edge.to, nodes);
          if (!from || !to) return null;
          const x1 = sectionOrder.indexOf(from.section) * 250 + 95;
          const y1 = 80 + nodes.filter((node) => node.section === from.section).findIndex((node) => node.id === from.id) * 92;
          const x2 = sectionOrder.indexOf(to.section) * 250 + 25;
          const y2 = 80 + nodes.filter((node) => node.section === to.section).findIndex((node) => node.id === to.id) * 92;
          const active = activeEdges.includes(edge);
          return (
            <path
              key={`${edge.from}-${edge.to}-${index}`}
              className={cx("edge", edge.type, active && "active", selectedNodeId && !active && "dim")}
              d={`M${x1} ${y1} C${x1 + 95} ${y1}, ${x2 - 95} ${y2}, ${x2} ${y2}`}
            />
          );
        })}
      </svg>

      {sectionOrder.map((section) => {
        const sectionNodes = nodes.filter((node) => node.section === section);
        return (
          <section className="map-section" key={section}>
            <h3>{sectionLabels[section]}</h3>
            {sectionNodes.map((node) => {
              const Icon = node.icon;
              const selected = selectedNodeId === node.id;
              const related = activeEdges.some((edge) => edge.from === node.id || edge.to === node.id);
              return (
                <button
                  key={node.id}
                  className={cx("map-node", selected && "selected", selectedNodeId && !selected && !related && "dim")}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <Icon size={17} />
                  <strong>{node.title}</strong>
                  <small>{node.subtitle}</small>
                  <div>
                    <Tag value={node.relation} small />
                    <span className="confidence-mini">{node.confidence}</span>
                  </div>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function NodeDetail({
  node,
  clauses: currentClauses = clauses,
  companies: currentCompanies = companies
}: {
  node: ChainNode;
  clauses?: typeof clauses;
  companies?: typeof companies;
}) {
  const relatedCompanies = node.companies.map((id) => getCompany(id, currentCompanies)).filter(Boolean) as Company[];
  const relatedClauses = node.clauses.map((id) => currentClauses.find((clause) => clause.id === id)).filter(Boolean);
  const Icon = node.icon;
  const strongClauseCount = relatedClauses.filter((clause) => (clause?.confidence ?? 0) >= 85).length;
  const mediumClauseCount = relatedClauses.filter((clause) => (clause?.confidence ?? 0) >= 70 && (clause?.confidence ?? 0) < 85).length;
  const pendingClauseCount = relatedClauses.filter((clause) => (clause?.confidence ?? 0) < 70).length;

  return (
    <aside className="panel node-detail">
      <div className="node-detail-title">
        <div className="node-icon"><Icon size={22} /></div>
        <div>
          <span>节点详情</span>
          <h2>{node.title}</h2>
        </div>
        <Tag value={node.evidence} small />
      </div>
      <div className="confidence-line">
        <span>置信度</span>
        <b>{percent(node.confidence)}</b>
        <i style={{ width: `${node.confidence}%` }} />
      </div>
      <section>
        <h3>为什么纳入分析</h3>
        <p>{node.description}</p>
      </section>
      <section>
        <h3>对应政策条款</h3>
        {relatedClauses.length === 0 && <p className="empty-note">暂无明确条款映射。</p>}
        {relatedClauses.map((clause) => (
          <div className="mini-evidence" key={clause!.id}>
            <b>{clause!.no}</b>
            <p>{clause!.excerpt}</p>
          </div>
        ))}
      </section>
      <section>
        <h3>相关产业环节</h3>
        <div className="tag-row">
          {relatedCompanies.length ? relatedCompanies.map((company) => <span key={company.id}>{company.name}</span>) : <span>暂无明确公司映射</span>}
        </div>
      </section>
      <section>
        <h3>置信度评估</h3>
        <div className="confidence-breakdown">
          <span>强条款 {strongClauseCount}</span>
          <span>中等条款 {mediumClauseCount}</span>
          <span>待验证 {pendingClauseCount}</span>
        </div>
      </section>
    </aside>
  );
}

function ClausesView({ report }: { report: PolicyReport | null }) {
  const currentPolicy = report?.policy ?? policy;
  const currentClauseGroups = report?.clauseGroups ?? clauseGroups;
  const currentClauses = report?.clauses ?? clauses;
  const currentEvidence = report?.evidence ?? evidence;
  const [selectedClauseId, setSelectedClauseId] = useState(currentClauses[0]?.id ?? "c4");
  const [clauseQuery, setClauseQuery] = useState("");
  const normalizedClauseQuery = clauseQuery.trim().toLowerCase();
  const visibleClauses = normalizedClauseQuery
    ? currentClauses.filter((clause) =>
        [clause.no, clause.title, clause.excerpt, ...clause.keywords, ...clause.industries]
          .join(" ")
          .toLowerCase()
          .includes(normalizedClauseQuery)
      )
    : currentClauses;
  const selected = currentClauses.find((clause) => clause.id === selectedClauseId) || currentClauses[0];
  const policySourceUrl = getPolicySourceUrl(currentPolicy);
  const structureGroups = currentClauseGroups.length
    ? currentClauseGroups
    : [{ id: "ungrouped", title: "未分组条款", count: currentClauses.length, tone: "blue" as const }];
  const selectedEvidence = selected
    ? currentEvidence.filter((item) => item.clauseIds?.includes(selected.id)).slice(0, 3)
    : [];

  useEffect(() => {
    if (!currentClauses.some((clause) => clause.id === selectedClauseId)) {
      setSelectedClauseId(currentClauses[0]?.id ?? "");
    }
  }, [currentClauses, selectedClauseId]);

  useEffect(() => {
    if (!normalizedClauseQuery || visibleClauses.length === 0) return;
    if (!visibleClauses.some((clause) => clause.id === selectedClauseId)) {
      setSelectedClauseId(visibleClauses[0].id);
    }
  }, [normalizedClauseQuery, selectedClauseId, visibleClauses]);

  function exportClauses() {
    const content = [
      `政策：${currentPolicy.title}`,
      `来源：${policySourceUrl || currentPolicy.source || "暂无"}`,
      "",
      ...currentClauses.map((clause) => `${clause.no} ${clause.title}\n置信度：${clause.confidence}%\n${clause.excerpt}\n`)
    ].join("\n");
    downloadTextFile(buildFilename(currentPolicy.title, "clauses"), content);
  }

  if (!selected) {
    return (
      <div className="clauses-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>政策条款结构图</h2>
          </div>
          <p className="empty-note">当前报表暂无条款抽取结果。</p>
        </section>
      </div>
    );
  }

  return (
    <div className="clauses-layout">
      <section className="panel clause-structure-panel">
        <div className="panel-head">
          <h2>政策条款结构图</h2>
          <button type="button" onClick={exportClauses}><Download size={15} /> 导出条款结构</button>
        </div>
        <div className="clause-orbit clause-structure-board">
          <div className="orbit-center clause-structure-summary">
            <strong>{currentPolicy.category || "政策"}</strong>
            <span>共 {structureGroups.length} 组，{currentClauses.length} 条</span>
            <em>按条款主题、证据置信度和产业映射组织</em>
          </div>
          <div className="clause-group-lanes">
            {structureGroups.map((group, index) => {
              const groupClauses = currentClauseGroups.length
                ? currentClauses.filter((clause) => clause.group === group.id)
                : currentClauses;
              const firstClause = groupClauses[0] || currentClauses[index] || currentClauses[0];
              const groupCount = groupClauses.length || group.count;
              const averageConfidence = groupClauses.length
                ? Math.round(groupClauses.reduce((sum, clause) => sum + clause.confidence, 0) / groupClauses.length)
                : 0;
              return (
                <button
                  key={group.id}
                  className={cx("orbit-item", "clause-group-lane", group.tone, selected?.group === group.id && "active")}
                  style={{ "--i": index } as React.CSSProperties}
                  onClick={() => {
                    if (firstClause) setSelectedClauseId(firstClause.id);
                  }}
                >
                  <span className="clause-group-index">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{group.title}</strong>
                  <em>{groupCount} 条 · {averageConfidence || "待评估"}% 平均置信</em>
                  <div className="clause-group-preview">
                    {groupClauses.slice(0, 2).map((clause) => (
                      <small key={clause.id}>{clause.no} {compactText(clause.title || clause.excerpt, 28)}</small>
                    ))}
                    {groupClauses.length === 0 && <small>暂无映射条款</small>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel clause-list-panel">
        <div className="panel-head">
          <h2>政策条款列表 <span>共{visibleClauses.length}/{currentClauses.length}条</span></h2>
          <div className="input-shell slim">
            <Search size={15} />
            <input
              value={clauseQuery}
              onChange={(event) => setClauseQuery(event.target.value)}
              placeholder="搜索条款内容、关键词"
              aria-label="搜索政策条款"
            />
          </div>
        </div>
        <div className="clause-list">
          {visibleClauses.length === 0 && <p className="empty-note">没有匹配的政策条款。</p>}
          {visibleClauses.map((clause) => (
            <button key={clause.id} className={cx("clause-list-item", selectedClauseId === clause.id && "active")} onClick={() => setSelectedClauseId(clause.id)}>
              <b>{clause.no}</b>
              <span>{clause.title}</span>
              <p>{clause.excerpt}</p>
              <em>{clause.confidence}%</em>
            </button>
          ))}
        </div>
      </section>

      <aside className="panel clause-detail clause-detail-panel">
        <div className="row-between clause-detail-toolbar">
          <h2>条款详情</h2>
          {policySourceUrl ? (
            <a className="text-button" href={policySourceUrl} target="_blank" rel="noreferrer">
              查看原文 <ExternalLink size={14} />
            </a>
          ) : (
            <span className="muted">暂无原文链接</span>
          )}
        </div>
        <div className="clause-detail-hero">
          <span className="status-badge blue">{selected.no}</span>
          <div>
            <p className="clause-detail-kicker">结构化条款</p>
            <h3>{selected.title || "未命名条款"}</h3>
          </div>
        </div>
        <div className="clause-detail-meta-grid">
          <article>
            <span>置信度</span>
            <strong>{selected.confidence}%</strong>
            <i><b style={{ width: `${selected.confidence}%` }} /></i>
          </article>
          <article>
            <span>关键词</span>
            <strong>{selected.keywords.slice(0, 3).join(" / ") || "待补充"}</strong>
          </article>
          <article>
            <span>关联证据</span>
            <strong>{selectedEvidence.length ? `${selectedEvidence.length} 条` : "政策原文"}</strong>
          </article>
        </div>
        <section className="clause-explain-block">
          <h4>条款解读</h4>
          <p>{selected.excerpt}</p>
        </section>
        <section className="clause-industries-block">
          <h4>关联产业环节</h4>
          <div className="tag-row">
            {selected.industries.length
              ? selected.industries.map((item) => <span key={item}>{item}</span>)
              : <span>暂无明确产业映射</span>}
          </div>
        </section>
        <section className="clause-evidence-block">
          <h4>证据摘录</h4>
          <div className="clause-evidence-list">
            {selectedEvidence.length ? (
              selectedEvidence.map((item) => (
                <article className="evidence-excerpt-card" key={item.id}>
                  <div className="evidence-excerpt-head">
                    <span>{formatSourceTypeLabel(item.type, "证据")}</span>
                    <em>{formatSourceTypeLabel(item.source, "未标注来源")} · {item.confidence}%</em>
                  </div>
                  <p>{item.excerpt}</p>
                </article>
              ))
            ) : (
              <article className="evidence-excerpt-card policy-text-evidence">
                <div className="evidence-excerpt-head">
                  <span>{selected.no}</span>
                  <em>政策原文 · 已定位到条款</em>
                </div>
                <p>{selected.excerpt}</p>
                <footer>
                  <Tag value="强证据" small />
                  <span>{currentPolicy.issuer || "发布机构"}</span>
                </footer>
              </article>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

function BackgroundView({ report }: { report: PolicyReport | null }) {
  const currentPolicy = report?.policy ?? policy;
  const currentBackgroundCards = report ? report.backgroundCards : backgroundCards;
  const currentEvidence = report?.evidence ?? evidence;
  const currentClauses = report?.clauses ?? clauses;
  const currentChainNodes = report?.chainNodes ?? chainNodes;
  const policySourceUrl = getPolicySourceUrl(currentPolicy);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const backgroundFactors = [
    ["供给侧", "数据资源分散、质量参差", "公共/企业/个人数据融合应用仍需制度化"],
    ["流通侧", "交易与定价机制不完善", "登记、结算、合规流通基础设施仍在建设"],
    ["需求侧", "产业应用场景扩张", "金融、制造、城市治理形成高价值数据需求"],
    ["约束侧", "安全与隐私保护要求提升", "分类分级、风险评估、合规审计成为底线"]
  ];
  const visibleBackgroundFactors = report
    ? currentBackgroundCards.map((card, index) => [`背景${index + 1}`, formatSourceTypeLabel(card.title, `背景${index + 1}`), card.body])
    : backgroundFactors;
  const diagnosisItems = currentEvidence.slice(0, 4).map((item) => [
    item.excerpt,
    formatSourceTypeLabel(item.source, "未标注来源"),
    formatSourceTypeLabel(item.type, "证据"),
    item.confidence >= 85 ? "高" : "中"
  ]);
  const timelineItems = [
    {
      type: "policy" as const,
      date: currentPolicy.publishDate,
      title: "政策发布",
      body: `${currentPolicy.issuer || "发布机构"}发布${currentPolicy.category || "政策文件"}。`
    },
    {
      type: "policy" as const,
      date: currentPolicy.effectiveDate,
      title: "政策生效",
      body: `影响范围：${inferPolicyScope(currentPolicy)}。`
    },
    ...currentEvidence.slice(0, 4).map((item) => ({
      type: "evidence" as const,
      date: item.date || currentPolicy.publishDate,
      title: formatSourceTypeLabel(item.type, "证据"),
      body: `${formatSourceTypeLabel(item.source, "未标注来源")}：${compactText(item.excerpt, 56)}`
    })),
    {
      type: "analysis" as const,
      date: report?.generatedAt?.slice(0, 10) || currentPolicy.publishDate,
      title: "系统生成分析",
      body: `已形成 ${currentClauses.length} 条条款、${currentChainNodes.length} 个产业节点、${currentEvidence.length} 条证据。`
    }
  ].filter((item, index, list) => item.date || index === list.length - 1);
  const visibleTimeline = timelineItems.filter((item) => timelineFilter === "all" || item.type === timelineFilter);
  const dataCoverage = [
    ["政策来源", policySourceUrl ? "已保存" : "缺失", policySourceUrl ? "可跳转原文" : "需要补充 URL", policySourceUrl ? 92 : 24],
    ["条款结构", `${currentClauses.length} 条`, "来自政策原文切分", Math.min(100, currentClauses.length * 14)],
    ["证据摘录", `${currentEvidence.length} 条`, "用于支撑结论", Math.min(100, currentEvidence.length * 12)],
    ["产业节点", `${currentChainNodes.length} 个`, currentChainNodes.length ? "由文本命中生成" : "尚未生成", Math.min(100, currentChainNodes.length * 18)]
  ];

  return (
    <div className="background-layout">
      <section className="panel background-factor-panel">
        <div className="panel-head">
          <div>
            <h2>政策出台背景</h2>
            <p>按供给、流通、需求、约束四个客观维度梳理政策出台原因。</p>
          </div>
        </div>
        <div className="factor-list">
          {visibleBackgroundFactors.map(([type, title, body], index) => (
            <article key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <b>{type}</b>
                <strong>{title}</strong>
                <p>{body}</p>
              </div>
              <Tag value={index === 3 ? "约束风险" : index === 1 ? "间接相关" : "直接相关"} small />
            </article>
          ))}
        </div>
      </section>
      <section className="panel timeline-panel">
        <div className="panel-head">
          <h2>时间线</h2>
          <div className="segmented-filter">
            {[
              ["all", "全部"],
              ["policy", "政策"],
              ["evidence", "证据"],
              ["analysis", "分析"]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cx(timelineFilter === value && "active")}
                onClick={() => setTimelineFilter(value as TimelineFilter)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="timeline timeline-flow">
          {visibleTimeline.map((item, index) => (
            <article key={`${item.type}-${item.date}-${index}`}>
              <span>{formatDateLabel(item.date)}</span>
              <b>{item.title}</b>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel market-panel">
        <div className="panel-head">
          <div>
            <h2>材料与数据覆盖</h2>
            <p>只展示当前政策真实入库和人工分析得到的数据覆盖，不使用外部市场规模样例。</p>
          </div>
        </div>
        <div className="market-grid">
          {dataCoverage.map(([label, value, growth, width]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <em>{growth}</em>
              <i><b style={{ width: `${width}%` }} /></i>
            </article>
          ))}
        </div>
      </section>
      <section className="panel diagnosis-panel">
        <div className="panel-head">
          <div>
            <h2>客观问题/机会证据</h2>
            <p>不做主观判断，展示结论来源和对应依据。</p>
          </div>
        </div>
        {diagnosisItems.length === 0 && <p className="empty-note">暂无背景证据。</p>}
        {diagnosisItems.map(([body, source, clue, level]) => (
          <article key={body}>
            <Tag value={level === "高" ? "直接相关" : "间接相关"} small />
            <div>
              <span>{body}</span>
              <em>{source} · {clue}</em>
            </div>
            <b>{level}</b>
          </article>
        ))}
      </section>
    </div>
  );
}

function CompareView({ report }: { report: PolicyReport | null }) {
  const currentPolicy = report?.policy ?? policy;
  const currentActions = report?.actions ?? actions;
  const currentClauseGroups = report?.clauseGroups ?? clauseGroups;
  const currentClauses = report?.clauses ?? clauses;
  const currentChainNodes = report?.chainNodes ?? chainNodes;
  const currentEvidence = report?.evidence ?? evidence;
  const compareInsight = report?.compareInsights;
  const coverage = report?.analysisCoverage;
  const similarBase = compareInsight?.similarPolicy || compareInsight?.similarPolicies?.[0] || null;
  const differenceBase = compareInsight?.differencePolicy || compareInsight?.contrastPolicies?.[0] || null;
  const noBaselineLabel = "暂无入库基准";
  const topActionText = currentActions.slice(0, 3).map((item) => item.title).filter(Boolean).join("；") || "尚未返回政策动作";
  const topNodeText = currentChainNodes.slice(0, 4).map((item) => item.title).filter(Boolean).join("、") || "尚未形成产业节点";
  const highEvidenceCount = currentEvidence.filter((item) => item.confidence >= 85).length;
  const coverageSummary = coverage
    ? `条款 ${coverage.clauseCount}、证据 ${coverage.evidenceCount}、产业节点 ${coverage.industryNodeCount}、公司 ${coverage.companyCount}`
    : `条款 ${currentClauses.length}、证据 ${currentEvidence.length}、产业节点 ${currentChainNodes.length}`;
  const legacyRows = useMemo<CompareInsightRow[]>(() => (report ? report.compareRows : compareRows).map((row, index) => ({
    id: `legacy-${index + 1}`,
    dimension: row[0] || `对比维度${index + 1}`,
    current: row[1] || "",
    similar: row[2] || "",
    different: row[3] || ""
  })), [report]);
  const fallbackRows = useMemo<CompareInsightRow[]>(() => {
    const baselineCell = (item: typeof similarBase, label: string) =>
      item ? `已识别《${item.title}》，但该维度解释尚未返回。` : `${noBaselineLabel}：不生成${label}政策伪匹配。`;
    const clauseGroupSummary = currentClauseGroups.length
      ? currentClauseGroups.map((group) => `${group.title || "未命名分组"} ${group.count || currentClauses.filter((clause) => clause.group === group.id).length} 条`).join("、")
      : "尚未返回条款分组";

    return [
      {
        id: "coverage-scope",
        dimension: "政策定位与适用范围",
        current: `${currentPolicy.category || "政策文件"}，适用范围：${inferPolicyScope(currentPolicy)}。发布机构：${currentPolicy.issuer || "待补充"}。`,
        similar: baselineCell(similarBase, "相似"),
        different: baselineCell(differenceBase, "差异")
      },
      {
        id: "coverage-actions",
        dimension: "目标抓手",
        current: `核心动作：${topActionText}。`,
        similar: baselineCell(similarBase, "相似"),
        different: baselineCell(differenceBase, "差异")
      },
      {
        id: "coverage-clauses",
        dimension: "条款结构",
        current: `已抽取 ${currentClauses.length} 条条款；${clauseGroupSummary}。`,
        similar: baselineCell(similarBase, "相似"),
        different: baselineCell(differenceBase, "差异")
      },
      {
        id: "coverage-impact",
        dimension: "产业影响链路",
        current: `已形成 ${currentChainNodes.length} 个产业节点，重点指向：${topNodeText}。`,
        similar: baselineCell(similarBase, "相似"),
        different: baselineCell(differenceBase, "差异")
      },
      {
        id: "coverage-evidence",
        dimension: "证据支撑",
        current: `已收录 ${currentEvidence.length} 条证据，其中高置信证据 ${highEvidenceCount} 条；来源与类型标签已中文化。`,
        similar: baselineCell(similarBase, "相似"),
        different: baselineCell(differenceBase, "差异")
      }
    ];
  }, [currentActions, currentChainNodes, currentClauseGroups, currentClauses, currentEvidence, currentPolicy, differenceBase, highEvidenceCount, noBaselineLabel, similarBase, topActionText, topNodeText]);
  const displayedRows = useMemo<CompareInsightRow[]>(() => {
    if (compareInsight?.rows?.length) return compareInsight.rows;
    if (legacyRows.length) return legacyRows;
    return fallbackRows;
  }, [compareInsight?.rows, fallbackRows, legacyRows]);
  const [selectedRowId, setSelectedRowId] = useState(displayedRows[0]?.id ?? "");
  const selectedRow = displayedRows.find((row) => row.id === selectedRowId) || displayedRows[0];
  const detailClause = selectedRow?.clauseIds?.length
    ? currentClauses.find((clause) => selectedRow.clauseIds?.includes(clause.id))
    : currentClauses[0];

  useEffect(() => {
    if (displayedRows.length === 0) {
      if (selectedRowId) setSelectedRowId("");
      return;
    }

    if (!displayedRows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(displayedRows[0].id);
    }
  }, [displayedRows, selectedRowId]);

  function baselineMeta(item: typeof similarBase) {
    if (!item) return "仍展示当前政策维度，不生成伪匹配";
    const parts = [
      item.issuer,
      item.publishDate,
      typeof item.similarity === "number" ? `相似度 ${item.similarity}/100` : ""
    ].filter(Boolean);
    return parts.join(" · ") || "已入库政策基准";
  }

  function baselineTitle(item: typeof similarBase, fallback: string) {
    return item?.title || fallback;
  }

  function rowCells(row: typeof displayedRows[number]) {
    return [row.dimension, row.current, row.similar, row.different];
  }

  const comparableCount = compareInsight?.comparableCount ?? coverage?.comparablePolicyCount ?? 0;
  const hasBaseline = Boolean(similarBase || differenceBase || comparableCount > 0);
  const emptyCompareReason = compareInsight?.emptyReason || "暂无入库基准；已按当前政策结构展示可比分析维度。";
  const rowSimilarityPoints = displayedRows
    .filter((row) => row.similar && !row.similar.includes(noBaselineLabel))
    .slice(0, 3)
    .map((row) => `在“${row.dimension}”维度：${row.similar}`);
  const rowDifferencePoints = displayedRows
    .filter((row) => row.different && !row.different.includes(noBaselineLabel))
    .slice(0, 3)
    .map((row) => `在“${row.dimension}”维度：${row.different}`);
  const similarityPoints = compareInsight?.similarityPoints?.length
    ? compareInsight.similarityPoints
    : rowSimilarityPoints.length
      ? rowSimilarityPoints
      : [
          `${noBaselineLabel}。本页先把当前政策拆成“定位、抓手、条款、影响、证据”五个可比维度。`,
          `当前政策覆盖：${coverageSummary}；后续有基准入库后可直接复用这些维度做相似性计算。`
        ];
  const differencePoints = compareInsight?.differencePoints?.length
    ? compareInsight.differencePoints
    : rowDifferencePoints.length
      ? rowDifferencePoints
      : [
          `${noBaselineLabel}。差异判断需要真实基准政策，因此这里不生成虚构差异结论。`,
          `当前可先关注政策自身的独特覆盖：${topActionText}；产业链路集中于 ${topNodeText}。`
        ];
  const compareStatusText = hasBaseline
    ? `系统已检索 ${comparableCount} 篇已发布政策作为基准。${compareInsight?.method || compareInsight?.basis || "下方按维度展示相似与差异依据。"}`
    : `${emptyCompareReason} 当前覆盖 ${coverageSummary}，可用于后续真实基准入库后的逐项比较。`;

  function exportCompareReport() {
    const content = [
      `政策对比报告：${currentPolicy.title}`,
      `发布日期：${currentPolicy.publishDate || "待补充"}`,
      `相似基准：${baselineTitle(similarBase, noBaselineLabel)}`,
      `差异基准：${baselineTitle(differenceBase, noBaselineLabel)}`,
      "",
      "相似点：",
      ...similarityPoints.map((item) => `- ${item}`),
      "",
      "不同点：",
      ...differencePoints.map((item) => `- ${item}`),
      "",
      "维度矩阵：",
      ...displayedRows.map((row) => rowCells(row).join(" | ")),
      "",
      "覆盖情况：",
      coverage
        ? `条款 ${coverage.clauseCount}，证据 ${coverage.evidenceCount}，产业节点 ${coverage.industryNodeCount}，公司 ${coverage.companyCount}，可比政策 ${coverage.comparablePolicyCount ?? 0}`
        : coverageSummary
    ].join("\n");
    downloadTextFile(buildFilename(currentPolicy.title, "compare"), content);
  }

  return (
    <div className="compare-layout">
      <section className="panel compare-main">
        <div className="panel-head">
          <div>
            <h2>对比分析</h2>
            <p>通过已入库政策文本、条款与影响层面的多维对比，识别相似政策和差异政策。</p>
          </div>
          <div className="toolbar">
            <button type="button" onClick={exportCompareReport}><Download size={15} /> 导出对比报告</button>
          </div>
        </div>
        <div className="analysis-note">{compareStatusText}</div>
        <div className="compare-analysis-summary">
          <article>
            <span>当前覆盖</span>
            <strong>{coverageSummary}</strong>
            <p>先把本政策整理成稳定可比口径，避免基准缺失时页面只剩空状态。</p>
          </article>
          <article>
            <span>基准状态</span>
            <strong>{hasBaseline ? `${comparableCount} 篇可比政策` : noBaselineLabel}</strong>
            <p>{hasBaseline ? "相似与差异结论来自入库基准。" : "未指向具体政策，不生成伪匹配。"}</p>
          </article>
          <article>
            <span>分析重心</span>
            <strong>{topActionText}</strong>
            <p>产业链路：{topNodeText}</p>
          </article>
        </div>
        <div className="compare-cards">
          <article className="compare-card current-policy-card">
            <span>当前政策</span>
            <strong>{currentPolicy.title}</strong>
            <p>{currentPolicy.issuer} · {currentPolicy.publishDate || "待补充"}</p>
          </article>
          <GitCompareArrows className="compare-link-icon" size={22} />
          <article className={cx("compare-card", "baseline-card", !similarBase && "missing-baseline")}>
            <span>相似基准</span>
            <strong>{baselineTitle(similarBase, noBaselineLabel)}</strong>
            <p>{baselineMeta(similarBase)}</p>
          </article>
          <GitCompareArrows className="compare-link-icon" size={22} />
          <article className={cx("compare-card", "baseline-card", !differenceBase && "missing-baseline")}>
            <span>差异基准</span>
            <strong>{baselineTitle(differenceBase, noBaselineLabel)}</strong>
            <p>{baselineMeta(differenceBase)}</p>
          </article>
        </div>
        <div className="compare-insight-grid">
          <section>
            <h3>相似在哪</h3>
            {similarityPoints.map((item) => <p key={item}>{item}</p>)}
          </section>
          <section>
            <h3>不同在哪</h3>
            {differencePoints.map((item) => <p key={item}>{item}</p>)}
          </section>
        </div>
        <div className="matrix-table">
          <div className="matrix-row header">
            <span>对比维度</span>
            <span>当前政策（{currentPolicy.publishDate?.slice(0, 4) || "本次"}）</span>
            <span>相似基准</span>
            <span>差异基准</span>
          </div>
          {displayedRows.length === 0 ? (
            <p className="empty-note">{emptyCompareReason}</p>
          ) : (
            displayedRows.map((row) => (
              <button
                type="button"
                className={cx("matrix-row", "interactive", selectedRow?.id === row.id && "active")}
                key={row.id}
                onClick={() => setSelectedRowId(row.id)}
              >
                {rowCells(row).map((cell, index) => (
                  <span className={cx(!cell && "matrix-cell-empty", cell?.includes(noBaselineLabel) && "matrix-cell-no-baseline")} key={`${row.id}-${index}`}>
                    {cell || (index > 1 ? noBaselineLabel : "待补充")}
                  </span>
                ))}
              </button>
            ))
          )}
        </div>
      </section>
      <aside className="panel compare-detail compare-detail-panel">
        <h2>对比项详情</h2>
        <h3>{selectedRow ? selectedRow.dimension : "暂无选中维度"}</h3>
        <section className="compare-detail-section current-policy-section">
          <h4>当前政策</h4>
          <p>{selectedRow?.current || `当前政策已覆盖 ${coverageSummary}，该维度摘要待补充。`}</p>
        </section>
        <section className="compare-detail-section baseline-section">
          <h4>相似基准</h4>
          <p>{selectedRow?.similar || `${noBaselineLabel}；该维度保留为后续真实基准入库后的对照位。`}</p>
        </section>
        <section className="compare-detail-section contrast-section">
          <h4>差异基准</h4>
          <p>{selectedRow?.different || `${noBaselineLabel}；差异解释需要真实基准政策支撑。`}</p>
        </section>
        {selectedRow?.explanation && (
          <section>
            <h4>系统解释</h4>
            <p>{selectedRow.explanation}</p>
          </section>
        )}
        <section>
          <h4>条款依据</h4>
          <p>{detailClause?.excerpt || "当前维度未关联到具体条款。"}</p>
        </section>
        {currentChainNodes.length > 0 && (
          <section>
            <h4>关联分析维度</h4>
            <div className="tag-row">
              {currentChainNodes.slice(0, 6).map((node) => <span key={node.id}>{node.title}</span>)}
            </div>
          </section>
        )}
        <section>
          <h4>分析覆盖</h4>
          <div className="score-band">
            <div>
              <span>综合置信度</span>
              <strong>{currentPolicy.confidence}<small>/100</small></strong>
            </div>
            <i><b style={{ width: `${currentPolicy.confidence}%` }} /></i>
            <p>
              证据 {currentEvidence.length} 条 · 条款 {currentClauses.length} 条 · 产业节点 {currentChainNodes.length} 个
              {coverage ? ` · 可比政策 ${coverage.comparablePolicyCount ?? 0} 篇` : ""}
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}

function EvidenceView({ report }: { report: PolicyReport | null }) {
  const currentEvidence = report?.evidence ?? evidence;
  const highEvidence = currentEvidence.filter((item) => item.confidence >= 85).length;
  const mediumEvidence = currentEvidence.filter((item) => item.confidence >= 70 && item.confidence < 85).length;
  const pendingEvidence = currentEvidence.filter((item) => item.confidence >= 50 && item.confidence < 70).length;
  const weakEvidence = currentEvidence.filter((item) => item.confidence < 50).length;
  const policyOriginalEvidence = currentEvidence.filter((item) => formatSourceTypeLabel(item.type, "").includes("政策原文")).length;

  return (
    <div className="evidence-layout">
      <section className="panel evidence-main">
        <div className="panel-head">
          <h2>证据链总览</h2>
          <p>把政策条款、原文摘录和外部证据放在同一个可信度框架内。</p>
        </div>
        <div className="evidence-stats">
          {[
            ["证据总量", `${currentEvidence.length} 条`],
            ["高相关证据", `${highEvidence} 条`],
            ["政策原文", `${policyOriginalEvidence} 条`],
            ["外部验证", `${Math.max(0, currentEvidence.length - policyOriginalEvidence)} 条`]
          ].map(([label, value]) => (
            <article key={label}><span>{label}</span><strong>{value}</strong></article>
          ))}
        </div>
        <EvidenceSnippets evidenceItems={currentEvidence} />
      </section>
      <aside className="panel">
        <h2>信号强度分布</h2>
        <div className="donut" />
        <ul className="legend-list">
          <li><span className="dot green" /> 强证据 {highEvidence}</li>
          <li><span className="dot blue" /> 中性 {mediumEvidence}</li>
          <li><span className="dot orange" /> 待验证 {pendingEvidence}</li>
          <li><span className="dot red" /> 弱/风险 {weakEvidence}</li>
        </ul>
      </aside>
    </div>
  );
}

function reportStatusLabel(status: ReportStatus) {
  const labels: Record<ReportStatus, string> = {
    published: "已发布",
    processing: "解析中",
    draft: "草稿",
    failed: "失败",
    reviewing: "审核中",
    archived: "已归档"
  };
  return labels[status];
}

function jobStatusLabel(status: JobStatus) {
  const labels: Record<JobStatus, string> = {
    queued: "排队中",
    fetching: "抓取中",
    extracting: "抽取中",
    analyzing: "分析中",
    published: "已发布",
    failed: "失败"
  };
  return labels[status];
}

function PolicyListView({
  reports,
  jobs,
  error,
  onOpenReport,
  repositoryMode
}: {
  reports: PolicySummary[];
  jobs: AnalysisJob[];
  error: string;
  onOpenReport: (reportId: string) => void;
  repositoryMode: RepositoryMode;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const publishedReports = reports.filter((item) => item.status === "published" && item.publishDate >= "2026-05-01");
  const visibleReports = normalizedQuery
    ? publishedReports.filter((item) =>
        [item.title, item.issuer, item.source, item.primarySignal]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : publishedReports;
  const latestPublished = publishedReports
    .filter((item) => item.publishDate)
    .map((item) => item.publishDate)
    .sort();
  const latestPublishedDate = latestPublished[latestPublished.length - 1] ?? "待发布";
  const stats: Array<{ label: string; value: string | number; icon: LucideIcon }> = [
    { label: "已发布报表", value: publishedReports.length, icon: FileText },
    { label: "最近发布", value: latestPublishedDate, icon: Clock },
    { label: "数据模式", value: repositoryMode === "supabase" ? "云端数据" : repositoryMode === "mock" ? "本地演示" : "未配置", icon: Globe2 },
    { label: "证据条目", value: publishedReports.reduce((sum, item) => sum + item.evidenceCount, 0), icon: ShieldCheck }
  ];

  return (
    <main className="landing-main">
      <section className="panel list-hero">
        <div>
          <span className="status-badge purple">工作台首页</span>
          <h1>政策监测与分析报表</h1>
          <p>这里是登录后的入口页。系统会按计划监测政府官网政策，并展示人工审核后的政策产业影响报表。</p>
        </div>
      </section>

      {error && (
        <section className="form-error workspace-error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </section>
      )}

      <section className="dashboard-stats">
        {stats.map(({ label, value, icon: Icon }) => (
          <article className="panel stat-tile" key={label}>
            <Icon size={22} />
            <span>{label}</span>
            <strong>{String(value)}</strong>
          </article>
        ))}
      </section>

      <section className="panel report-list-panel">
        <div className="panel-head">
          <div>
            <h2>政策分析报表</h2>
            <p>点击报表进入单政策交互分析页。</p>
          </div>
          <div className="input-shell slim">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索政策标题、来源、产业方向" />
          </div>
        </div>
        <div className="report-list">
          {publishedReports.length === 0 && <p className="empty-note">暂无可访问报表。请等待定时抓取完成，或检查 Supabase 发布数据与权限配置。</p>}
          {publishedReports.length > 0 && visibleReports.length === 0 && <p className="empty-note">没有匹配的政策报表。</p>}
          {visibleReports.map((item) => (
            <button key={item.id} onClick={() => onOpenReport(item.id)}>
              <div className="report-list-title">
                <span className={cx("status-badge", item.status === "published" ? "blue" : "purple")}>
                  {reportStatusLabel(item.status)}
                </span>
                <strong>{item.title}</strong>
                <p>{item.issuer} · {item.source} · {item.publishDate}</p>
              </div>
              <div className="report-list-metrics">
                <span>置信度 <b>{item.confidence}</b></span>
                <span>产业节点 <b>{item.industryCount}</b></span>
                <span>代表公司 <b>{item.companyCount}</b></span>
                <span>证据 <b>{item.evidenceCount}</b></span>
              </div>
              <div className="report-list-signal">
                <Tag value={item.primarySignal} small />
                <ChevronRight size={18} />
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="panel job-list-panel">
        <div className="panel-head">
          <div>
            <h2>后台运行状态</h2>
            <p>政策由后台定时抓取，分析由 Codex 手动审核后发布。普通用户只查看已发布报表，不能创建新的政策分析任务。</p>
          </div>
        </div>
        <div className="job-list">
          <article>
            <div>
              <span className={cx("status-badge", repositoryMode === "supabase" ? "blue" : "purple")}>
                {repositoryMode === "supabase" ? "云端运行" : repositoryMode === "mock" ? "本地演示" : "未配置"}
              </span>
              <strong>
                {repositoryMode === "supabase"
                  ? "定时抓取与人工分析发布已接入云端数据源"
                  : repositoryMode === "mock"
                    ? "当前使用显式本地演示数据"
                    : "当前缺少 Supabase 前端配置"}
              </strong>
              <p>{repositoryMode === "supabase" ? "任务队列仅管理员可见；普通用户只消费已发布结果。" : "生产环境若缺少 Supabase 配置，不会回退到样例报表。"}</p>
            </div>
            <div className="job-progress">
              <span>{jobs.length > 0 ? `后台任务 ${jobs.length} 条` : "任务明细不可见"}</span>
              <b>{repositoryMode === "supabase" ? "待人工分析" : repositoryMode === "mock" ? "演示" : "待配置"}</b>
              <i style={{ width: repositoryMode === "supabase" ? "100%" : repositoryMode === "mock" ? "38%" : "8%" }} />
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}

function ModuleContent({
  activeModule,
  setActiveModule,
  selectedNodeId,
  setSelectedNodeId,
  onCompanySelect,
  report
}: {
  activeModule: ModuleId;
  setActiveModule: (module: ModuleId) => void;
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
  onCompanySelect?: (companyId: string, source?: string) => void;
  report: PolicyReport | null;
}) {
  if (activeModule === "industry") {
    return <IndustryView selectedNodeId={selectedNodeId} setSelectedNodeId={setSelectedNodeId} setActiveModule={setActiveModule} report={report} />;
  }
  if (activeModule === "clauses") return <ClausesView report={report} />;
  if (activeModule === "background") return <BackgroundView report={report} />;
  if (activeModule === "compare") return <CompareView report={report} />;
  if (activeModule === "companies") {
    return (
      <CompaniesView
        chainNodes={report?.chainNodes ?? []}
        clauses={report?.clauses ?? []}
        companies={report?.companies ?? []}
        evidence={report?.evidence ?? []}
        onCompanySelect={onCompanySelect}
      />
    );
  }
  if (activeModule === "evidence") return <EvidenceView report={report} />;
  return <BriefView setActiveModule={setActiveModule} report={report} />;
}

function ReportLoadState({
  loading,
  error,
  report
}: {
  loading: boolean;
  error: string;
  report: PolicyReport | null;
}) {
  if (!loading && !error && !report) return null;

  return (
    <section className={cx("report-load-banner", error && "error")}>
      {loading ? (
        <>
          <RefreshCw size={15} />
          <span>正在加载报表数据...</span>
        </>
      ) : error ? (
        <>
          <AlertCircle size={15} />
          <span>{error}</span>
        </>
      ) : (
        <>
          <CheckCircle2 size={15} />
          <span>已加载报表：{report?.summary.title}</span>
        </>
      )}
    </section>
  );
}

function ReportUnavailableState({
  loading,
  error
}: {
  loading: boolean;
  error: string;
}) {
  const title = loading ? "正在读取报表" : error ? "报表无法显示" : "暂无有效报表";
  const body = loading
    ? "系统正在读取当前政策的结构化报表，完成后会显示产业链、条款、背景、对比和证据模块。"
    : error
      ? "为避免展示不匹配的示例数据，本页不会回退到默认报表。请返回列表选择其他报表，或检查后端报表 payload。"
      : "当前没有可显示的报表数据。";

  return (
    <section className={cx("panel report-unavailable", error && "error")}>
      {loading ? <RefreshCw size={18} /> : <AlertCircle size={18} />}
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </section>
  );
}

function readStoredUser(): SessionUser | null {
  if (isSupabaseConfigured) return null;

  const stored = window.localStorage.getItem("policy-terminal-user");
  if (!stored) return null;

  try {
    return JSON.parse(stored) as SessionUser;
  } catch {
    window.localStorage.removeItem("policy-terminal-user");
    return null;
  }
}

function toAdminBehaviorFilters(filters: AdminViewFilters): AdminBehaviorFilters {
  const now = new Date();
  const endDate = filters.timeRange === "custom" ? toEndOfDayIso(filters.to) : now.toISOString();
  const startDate =
    filters.timeRange === "custom"
      ? toStartOfDayIso(filters.from)
      : new Date(now.getTime() - getAdminRangeMs(filters.timeRange)).toISOString();

  return {
    startDate,
    endDate,
    granularity: filters.timeRange === "24h" ? "hour" : "day",
    search: filters.username,
    policyRef: filters.policyId,
    moduleIds: filters.moduleId ? [filters.moduleId] : undefined,
    eventTypes: filters.eventType ? [filters.eventType] : undefined,
    limit: 50,
    offset: 0
  };
}

function getAdminRangeMs(range: AdminViewFilters["timeRange"]) {
  if (range === "24h") return 24 * 60 * 60 * 1000;
  if (range === "30d") return 30 * 24 * 60 * 60 * 1000;
  if (range === "90d") return 90 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function toStartOfDayIso(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function toEndOfDayIso(value?: string) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function policyTitleByRef(reports: PolicySummary[]) {
  return new Map(reports.map((item) => [item.id, item.title]));
}

function toUserBehaviorAnalyticsData(
  overview: AdminBehaviorOverview,
  list: AdminBehaviorListResult,
  detail: AdminBehaviorDetail | null,
  reports: PolicySummary[]
): UserBehaviorAnalyticsData {
  const reportTitles = policyTitleByRef(reports);
  const policyViews = overview.summary.policyViewEvents || overview.summary.policyOpenEvents;

  return {
    kpis: [
      { id: "total-users", label: "总用户数", value: overview.summary.totalUsers || overview.summary.uniqueUsers },
      { id: "today-active", label: "今日活跃用户", value: overview.summary.todayActiveUsers },
      { id: "seven-day-active", label: "近 7 日活跃用户", value: overview.summary.last7dActiveUsers },
      { id: "total-events", label: "总访问事件数", value: overview.summary.totalEvents },
      { id: "policy-views", label: "政策查看次数", value: policyViews },
      { id: "avg-policy-duration", label: "平均政策停留时长", value: formatAdminDuration(overview.summary.avgPolicyViewMs || overview.summary.avgDurationMs) }
    ],
    trend: overview.series.map((point) => ({
      id: point.bucket,
      date: point.bucket,
      label: point.label || point.bucket,
      value: point.eventCount,
      uniqueUsers: point.uniqueUsers,
      sessions: point.sessionCount
    })),
    topPolicies: overview.topPolicies.slice(0, 10).map((item) => ({
      id: item.policyRef,
      label: item.title || reportTitles.get(item.policyRef) || item.policyRef,
      value: item.eventCount,
      helper: `${formatAdminNumber(item.uniqueUsers)} 用户`
    })),
    moduleDistribution: overview.topModules.slice(0, 10).map((item) => ({
      id: item.moduleId,
      label: item.moduleLabel || formatAdminModuleId(item.moduleId),
      value: item.eventCount,
      helper: `${formatAdminNumber(item.uniqueUsers)} 用户`
    })),
    eventDistribution: overview.eventBreakdown.slice(0, 10).map((item) => ({
      id: item.eventType,
      label: item.eventLabel || formatAdminEventType(item.eventType),
      value: item.eventCount,
      helper: `${formatAdminNumber(item.uniqueUsers)} 用户`
    })),
    users: list.rows.map((row) => ({
      id: row.userId,
      userId: row.userId,
      username: row.displayName,
      displayName: row.displayName,
      email: row.email,
      eventCount: row.eventCount,
      sessionCount: row.sessionCount,
      lastSeenAt: row.lastSeenAt,
      topPolicy: undefined,
      topModule: undefined
    })),
    userPaths: detail?.timeline.length && detail.user?.userId ? { [detail.user.userId]: detail.timeline.map(toAdminPathStep) } : {}
  };
}

function toAdminPathStep(item: AdminBehaviorTimelineItem): AdminAnalyticsPathStep {
  const labelParts = [
    item.eventLabel || formatAdminEventType(item.eventType),
    item.policyTitle,
    item.moduleLabel || (item.moduleId ? formatAdminModuleId(item.moduleId) : undefined)
  ].filter(Boolean);

  return {
    id: item.id,
    timestamp: item.occurredAt,
    label: labelParts.join(" · "),
    eventType: item.eventType,
    policyId: item.policyRef,
    policyLabel: item.policyTitle,
    moduleId: item.moduleId,
    moduleLabel: item.moduleLabel,
    routePath: item.routePath,
    durationMs: item.durationMs,
    metadata: item.metadata
  };
}

function toSessionUser(user: SupabaseUser): SessionUser {
  const metadata = user.user_metadata ?? {};
  const metadataName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : typeof metadata.display_name === "string"
          ? metadata.display_name
          : "";
  const email = user.email ?? "";

  return {
    id: user.id,
    email,
    name: metadataName || email.split("@")[0] || "研究员"
  };
}

export function App() {
  const repositoryMode = getReportRepositoryMode();
  const [user, setUser] = useState<SessionUser | null>(() => readStoredUser());
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [appView, setAppView] = useState<AppView>("list");
  const [adminAccess, setAdminAccess] = useState<CurrentUserAccess>(EMPTY_ADMIN_ACCESS);
  const [adminAccessLoading, setAdminAccessLoading] = useState(false);
  const [reports, setReports] = useState<PolicySummary[]>([]);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const [activeReport, setActiveReport] = useState<PolicyReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [selectedReportId, setSelectedReportId] = useState("data-elements-2024");
  const [activeModule, setActiveModule] = useState<ModuleId>("brief");
  const [selectedNodeId, setSelectedNodeId] = useState("exchange");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0);
  const [reportReloadKey, setReportReloadKey] = useState(0);
  const analyticsSessionIdRef = useRef(getAnalyticsSessionId());
  const trackedAppOpenRef = useRef(false);

  const activeChainNodes = activeReport?.chainNodes ?? [];
  const track = useCallback((event: TrackUserEventInput) => {
    if (!analyticsSessionIdRef.current) analyticsSessionIdRef.current = getAnalyticsSessionId();
    void trackUserEvent(user?.id, event);
  }, [user?.id]);

  useEffect(() => {
    if (appView !== "report" || activeChainNodes.length === 0) return;
    if (!activeChainNodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(activeChainNodes[0].id);
    }
  }, [activeChainNodes, appView, selectedNodeId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthLoading(false);
      return undefined;
    }

    let alive = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setUser(null);
        } else {
          setUser(data.session?.user ? toSessionUser(data.session.user) : null);
        }
        setAuthLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setUser(null);
        setAuthLoading(false);
      });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setUser(session?.user ? toSessionUser(session.user) : null);
      setAuthLoading(false);

      if (!session) {
        setReports([]);
        setJobs([]);
        setActiveReport(null);
        setWorkspaceError("");
        setReportError("");
        setAppView("list");
        setAdminAccess(EMPTY_ADMIN_ACCESS);
        setAdminAccessLoading(false);
      }
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user?.id) trackedAppOpenRef.current = false;
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) {
      setAdminAccess(EMPTY_ADMIN_ACCESS);
      setAdminAccessLoading(false);
      return undefined;
    }

    let alive = true;
    setAdminAccessLoading(true);
    loadCurrentUserAccess(user.id)
      .then((access) => {
        if (!alive) return;
        setAdminAccess(access);
      })
      .catch(() => {
        if (!alive) return;
        setAdminAccess({ ...EMPTY_ADMIN_ACCESS, userId: user.id ?? "" });
      })
      .finally(() => {
        if (alive) setAdminAccessLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (adminAccessLoading) return;
    if (appView === "adminAnalytics" && !adminAccess.canAccessAdmin) {
      setAppView("list");
    }
  }, [adminAccess.canAccessAdmin, adminAccessLoading, appView]);

  useEffect(() => {
    if (!user) return undefined;

    let alive = true;
    async function loadWorkspace() {
      try {
        setWorkspaceError("");
        const nextReports = await listPolicyReports();
        if (!alive) return;
        setReports(nextReports.filter((item) => item.status === "published"));
        setJobs([]);
      } catch (error) {
        if (!alive) return;
        const message = error instanceof Error ? error.message : "工作台数据加载失败";
        setWorkspaceError(message);
      }
    }

    void loadWorkspace();

    return () => {
      alive = false;
    };
  }, [user, workspaceReloadKey]);

  useEffect(() => {
    if (!user?.id || trackedAppOpenRef.current) return;
    trackedAppOpenRef.current = true;
    track({
      eventType: "app_open",
      metadata: {
        displayName: user.name
      }
    });
  }, [track, user?.id, user?.name]);

  useEffect(() => {
    if (!user?.id || appView !== "list") return;
    track({
      eventType: "policy_list_view",
      metadata: {
        reportCount: reports.length,
        jobCount: jobs.length
      }
    });
  }, [appView, jobs.length, reports.length, track, user?.id]);

  useEffect(() => {
    if (!user?.id || appView !== "report") return undefined;

    const startedAt = Date.now();
    track({
      eventType: "policy_view",
      policyRef: selectedReportId
    });

    return () => {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= 1000) {
        track({
          eventType: "policy_view_duration",
          policyRef: selectedReportId,
          durationMs
        });
      }
    };
  }, [appView, selectedReportId, track, user?.id]);

  useEffect(() => {
    if (!user?.id || appView !== "report") return undefined;

    const startedAt = Date.now();
    track({
      eventType: "module_view",
      policyRef: selectedReportId,
      moduleId: activeModule
    });

    return () => {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= 1000) {
        track({
          eventType: "module_view_duration",
          policyRef: selectedReportId,
          moduleId: activeModule,
          durationMs
        });
      }
    };
  }, [activeModule, appView, selectedReportId, track, user?.id]);

  useEffect(() => {
    if (!user || appView !== "report") return undefined;

    let alive = true;
    async function loadReport() {
      try {
        setReportLoading(true);
        setReportError("");
        const nextReport = await getPolicyReport(selectedReportId);
        if (!alive) return;
        setActiveReport(nextReport);
      } catch (error) {
        if (!alive) return;
        const message = error instanceof Error ? error.message : "报表数据加载失败";
        setActiveReport(null);
        setReportError(message);
      } finally {
        if (alive) setReportLoading(false);
      }
    }

    void loadReport();

    return () => {
      alive = false;
    };
  }, [appView, reportReloadKey, selectedReportId, user]);

  function handleLogin(nextUser: SessionUser) {
    setUser(nextUser);
    if (!isSupabaseConfigured) {
      window.localStorage.setItem("policy-terminal-user", JSON.stringify(nextUser));
    }
  }

  function openReport(reportId: string) {
    const reportSummary = reports.find((item) => item.id === reportId);
    track({
      eventType: "policy_open",
      policyRef: reportId,
      targetType: "policy",
      targetId: reportId,
      metadata: {
        title: reportSummary?.title,
        source: reportSummary?.source
      }
    });
    setSelectedReportId(reportId);
    setActiveReport(null);
    setReportError("");
    setActiveModule("brief");
    setMobileMenuOpen(false);
    setAppView("report");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function openList() {
    if (appView === "report") {
      track({
        eventType: "navigate_back_to_list",
        policyRef: selectedReportId,
        moduleId: activeModule
      });
    }
    setAppView("list");
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function openAdminAnalytics() {
    if (!adminAccess.canAccessAdmin) return;
    setAppView("adminAnalytics");
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function changeModule(module: ModuleId, source = "navigation") {
    track({
      eventType: "module_click",
      policyRef: selectedReportId,
      moduleId: module,
      targetType: "module",
      targetId: module,
      metadata: {
        source,
        previousModule: activeModule
      }
    });
    setActiveModule(module);
  }

  function selectIndustryNode(nodeId: string) {
    track({
      eventType: "industry_node_select",
      policyRef: selectedReportId,
      moduleId: activeModule,
      targetType: "industry_node",
      targetId: nodeId
    });
    setSelectedNodeId(nodeId);
  }

  function selectCompany(companyId: string, source = "companies") {
    track({
      eventType: "company_select",
      policyRef: selectedReportId,
      moduleId: activeModule,
      targetType: "company",
      targetId: companyId,
      metadata: {
        source
      }
    });
  }

  function refreshCurrentReport() {
    setWorkspaceReloadKey((value) => value + 1);
    setReportReloadKey((value) => value + 1);
  }

  const loadAdminAnalytics = useCallback(async (filters: AdminViewFilters): Promise<UserBehaviorAnalyticsData> => {
    const rpcFilters = toAdminBehaviorFilters(filters);
    const overviewPromise = fetchAdminBehaviorOverview(rpcFilters);
    const listPromise = fetchAdminBehaviorList(rpcFilters);
    const [overview, list] = await Promise.all([overviewPromise, listPromise]);
    const firstUserId = list.rows[0]?.userId;
    const detail = firstUserId ? await fetchAdminBehaviorDetail(firstUserId, rpcFilters) : null;
    return toUserBehaviorAnalyticsData(overview, list, detail, reports);
  }, [reports]);

  const loadAdminUserPath = useCallback(async (userId: string, filters: AdminViewFilters): Promise<AdminAnalyticsPathStep[]> => {
    const detail = await fetchAdminBehaviorDetail(userId, toAdminBehaviorFilters(filters));
    return detail.timeline.map(toAdminPathStep);
  }, []);

  function resetSessionState() {
    setUser(null);
    setAppView("list");
    setAdminAccess(EMPTY_ADMIN_ACCESS);
    setAdminAccessLoading(false);
    setReports([]);
    setJobs([]);
    setActiveReport(null);
    setWorkspaceError("");
    setReportError("");
    window.localStorage.removeItem("policy-terminal-user");
  }

  function logout() {
    track({
      eventType: "logout",
      policyRef: appView === "report" ? selectedReportId : undefined,
      moduleId: appView === "report" ? activeModule : undefined
    });
    resetSessionState();
    if (supabase) void supabase.auth.signOut();
  }

  if (authLoading) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-lockup auth-brand">
            <div className="brand-mark">P</div>
            <div>
              <strong>政策产业影响终端</strong>
              <span>正在恢复登录状态</span>
            </div>
          </div>
          <div className="auth-hero">
            <p className="eyebrow">政策智能分析终端</p>
            <h1>正在连接账户与报表工作台。</h1>
            <p>系统正在读取 Supabase 会话，完成后会自动进入终端或回到登录页。</p>
          </div>
        </section>
      </main>
    );
  }

  if (!user) return <AuthScreen onLogin={handleLogin} />;

  return (
    <div className="app-shell">
      <TopBar
        user={user}
        onLogout={logout}
        reports={reports}
        onOpenReport={openReport}
        repositoryMode={repositoryMode}
        activeView={appView}
        canOpenAdmin={adminAccess.canAccessAdmin}
        adminAccessLoading={adminAccessLoading}
        onOpenAdminAnalytics={openAdminAnalytics}
      />
      {appView === "report" && (
        <button className="mobile-menu-button" onClick={() => setMobileMenuOpen(true)}>
          <Menu size={18} />
          导航
        </button>
      )}
      {appView === "list" && (
        <PolicyListView reports={reports} jobs={jobs} error={workspaceError} onOpenReport={openReport} repositoryMode={repositoryMode} />
      )}
      {appView === "adminAnalytics" && (
        <UserBehaviorAnalyticsView
          canAccess={adminAccess.canAccessAdmin}
          accessLoading={adminAccessLoading}
          currentUser={{ id: user.id, email: user.email, name: user.name }}
          loadAnalytics={loadAdminAnalytics}
          loadUserPath={loadAdminUserPath}
        />
      )}
      {appView === "report" && (
        <div className="workspace" data-report-id={selectedReportId}>
          <div className={cx("mobile-sidebar-backdrop", mobileMenuOpen && "open")} onClick={() => setMobileMenuOpen(false)} />
          <div className={cx("sidebar-wrap", mobileMenuOpen && "open")}>
            <PolicySidebar
              activeModule={activeModule}
              setActiveModule={(module) => {
                changeModule(module, "sidebar");
                setMobileMenuOpen(false);
              }}
              collapsed={sidebarCollapsed}
              setCollapsed={setSidebarCollapsed}
              onBackToList={openList}
              report={activeReport}
            />
          </div>
          <main className="report-main">
            <ReportHeader
              activeModule={activeModule}
              setActiveModule={(module) => changeModule(module, "top_tab")}
              report={activeReport}
              onRefresh={refreshCurrentReport}
              refreshing={reportLoading}
            />
            <ReportLoadState loading={reportLoading} error={reportError} report={activeReport} />
            {activeReport ? (
              <ModuleContent
                activeModule={activeModule}
                setActiveModule={(module) => changeModule(module, "content")}
                selectedNodeId={selectedNodeId}
                setSelectedNodeId={selectIndustryNode}
                onCompanySelect={selectCompany}
                report={activeReport}
              />
            ) : (
              <ReportUnavailableState loading={reportLoading} error={reportError} />
            )}
          </main>
        </div>
      )}
    </div>
  );
}
