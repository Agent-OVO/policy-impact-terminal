import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import {
  AlertCircle,
  ArrowLeft,
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
  type ModuleId,
  type RelationType
} from "./data/policy";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { getAnalyticsSessionId, trackUserEvent, type TrackUserEventInput } from "./lib/analytics";
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

type AppView = "list" | "report";
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
          <p className="eyebrow">Policy Intelligence Terminal</p>
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
                pattern="[A-Za-z0-9_\\-]{3,32}"
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
          <strong>自动抓取政策原文并生成产业影响报告</strong>
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
  repositoryMode
}: {
  user: SessionUser;
  onLogout: () => void;
  reports: PolicySummary[];
  onOpenReport: (reportId: string) => void;
  repositoryMode: RepositoryMode;
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
              <p>当前为只读工作台。政策由后台定时抓取并自动生成分析。</p>
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
  const quickTake = currentActions[0]?.body ?? currentClauses[0]?.excerpt ?? "系统已读取政策原文，正在形成可追溯的政策影响摘要。";
  const quickItems = currentClauses.length
    ? currentClauses.slice(0, 4).map((clause) => `${clause.no || "条款"} ${clause.title || "核心内容"}：${clause.excerpt}`)
    : currentActions.slice(0, 4).map((action) => action.body);
  const kpis = [
    [`${currentClauses.length} 条`, "结构化条款", "来自政策原文分段"],
    [`${currentEvidence.length} 条`, "证据摘录", "可追溯到来源材料"],
    [`${currentChainNodes.length} 个`, "产业影响节点", currentChainNodes.length ? "由政策文本命中生成" : "尚未形成产业映射"],
    [currentCompanies.length ? `${currentCompanies.length} 家` : "未生成", "代表性公司", currentCompanies.length ? "仅服务本政策分析" : "不使用样例公司填充"],
    [`${currentPolicy.confidence}/100`, "整体置信度", policySourceUrl ? "含政策来源链接" : "等待来源链接"]
  ];
  const logicGoals = currentActions.slice(0, 3).map((action) => action.title).filter(Boolean);
  const logicPaths = currentClauses.slice(0, 3).map((clause) => clause.title || clause.no).filter(Boolean);
  const logicResults = currentChainNodes.slice(0, 3).map((node) => node.title).filter(Boolean);

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
            <span>来源：{currentPolicy.source || "官方来源"}</span>
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

      <section className="panel details-panel">
        <h2>速读详情</h2>
        <div className="score-inline">
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
            <p>按“政策动作 - 条款依据 - 产业影响”梳理，不再使用固定样例链路。</p>
          </div>
        </div>
        <div className="logic-map">
          <div>
            <span>政策动作</span>
            {(logicGoals.length ? logicGoals : ["政策原文已入库", "等待更深度模型分析", "形成可追溯报告"]).map((item) => <b key={item}>{compactText(item, 24)}</b>)}
          </div>
          <svg viewBox="0 0 220 160">
            <path d="M10 30 C70 30 70 30 110 30" />
            <path d="M10 80 C70 80 70 80 110 80" />
            <path d="M10 130 C70 130 70 130 110 130" />
            <path d="M110 30 C150 45 150 60 205 70" />
            <path d="M110 80 C150 80 150 80 205 80" />
            <path d="M110 130 C150 115 150 100 205 90" />
          </svg>
          <div>
            <span>条款依据</span>
            {(logicPaths.length ? logicPaths : ["暂无可展示条款"]).map((item) => <b key={item}>{compactText(item, 24)}</b>)}
          </div>
          <div>
            <span>影响方向</span>
            {(logicResults.length ? logicResults : policyTags.slice(0, 3).length ? policyTags.slice(0, 3) : ["尚未形成产业节点"]).map((item) => <b key={item}>{compactText(item, 24)}</b>)}
          </div>
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
          <em>{item.type} · {item.source}</em>
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
            地图只展示当前政策自动分析命中的产业节点；节点越亮表示与当前选择节点关系越近，点击节点可查看对应条款和证据。
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
      <section className="panel">
        <div className="panel-head">
          <h2>政策条款结构图</h2>
          <button type="button" onClick={exportClauses}><Download size={15} /> 导出条款结构</button>
        </div>
        <div className="clause-orbit">
          <div className="orbit-center">{currentPolicy.category || "政策"}<span>共 {currentClauseGroups.length || 1} 组，{currentClauses.length} 条</span></div>
          {currentClauseGroups.map((group, index) => (
            <button
              key={group.id}
              className={cx("orbit-item", group.tone)}
              style={{ "--i": index } as React.CSSProperties}
              onClick={() => {
                const firstClause = currentClauses.find((clause) => clause.group === group.id) || currentClauses[index] || currentClauses[0];
                if (firstClause) setSelectedClauseId(firstClause.id);
              }}
            >
              <strong>{group.title}</strong>
              <span>{group.count}条款</span>
            </button>
          ))}
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
            <button key={clause.id} className={cx(selectedClauseId === clause.id && "active")} onClick={() => setSelectedClauseId(clause.id)}>
              <b>{clause.no}</b>
              <span>{clause.title}</span>
              <p>{clause.excerpt}</p>
              <em>{clause.confidence}%</em>
            </button>
          ))}
        </div>
      </section>

      <aside className="panel clause-detail">
        <div className="row-between">
          <h2>条款详情</h2>
          {policySourceUrl ? (
            <a className="text-button" href={policySourceUrl} target="_blank" rel="noreferrer">
              查看原文 <ExternalLink size={14} />
            </a>
          ) : (
            <span className="muted">暂无原文链接</span>
          )}
        </div>
        <span className="status-badge blue">{selected.no}</span>
        <h3>{selected.title}</h3>
        <div className="confidence-line">
          <span>置信度</span>
          <b>{selected.confidence}%</b>
          <i style={{ width: `${selected.confidence}%` }} />
        </div>
        <section>
          <h4>条款解读</h4>
          <p>{selected.excerpt} 该条款对应数据资源开发利用和数据产业生态建设，是后续产业链映射的重要依据。</p>
        </section>
        <section>
          <h4>关联产业环节</h4>
          <div className="tag-row">{selected.industries.map((item) => <span key={item}>{item}</span>)}</div>
        </section>
        <section>
          <h4>原文证据摘录</h4>
          <blockquote className="evidence-quote">
            <span>{selected.no}</span>
            <p>{selected.excerpt}</p>
            <footer>
              <Tag value="强证据" small />
              <em>政策原文 · 已定位到条款</em>
            </footer>
          </blockquote>
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
    ? currentBackgroundCards.map((card, index) => [`背景${index + 1}`, card.title, card.body])
    : backgroundFactors;
  const diagnosisItems = currentEvidence.slice(0, 4).map((item) => [
    item.excerpt,
    item.source,
    item.type,
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
      title: item.type,
      body: `${item.source}：${compactText(item.excerpt, 56)}`
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
            <p>只展示当前政策真实入库和自动分析得到的数据覆盖，不使用外部市场规模样例。</p>
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
  const currentRows = report ? report.compareRows : compareRows;
  const currentActions = report?.actions ?? actions;
  const currentClauses = report?.clauses ?? clauses;
  const currentChainNodes = report?.chainNodes ?? chainNodes;
  const currentEvidence = report?.evidence ?? evidence;
  const similarityPoints = [
    "同样基于官方政策原文、发布时间、发布机关和条款摘录形成判断。",
    currentClauses.length ? `同样围绕 ${currentClauses.length} 条核心条款拆解政策动作。` : "同样以政策条款作为主证据入口。",
    currentEvidence.length ? `同样保留 ${currentEvidence.length} 条可追溯证据，避免只展示结论。` : "同样要求结论回到证据链。"
  ];
  const differencePoints = [
    currentActions[0]?.title ? `本政策最突出的动作是“${currentActions[0].title}”。` : "本政策尚未形成高置信动作。",
    currentChainNodes.length ? `产业影响集中在：${currentChainNodes.slice(0, 4).map((node) => node.title).join("、")}。` : "产业节点暂未生成，无法做产业差异判断。",
    currentEvidence.some((item) => item.confidence < 70) ? "部分证据低于 70 分，需要后续校验。" : "当前证据整体未暴露明显低置信段。"
  ];
  const displayedRows = currentRows.map((row, index) => {
    if (row.length >= 4) return row.slice(0, 4);
    return [
      row[0] || `维度${index + 1}`,
      row[1] || "已纳入本次分析",
      similarityPoints[index % similarityPoints.length],
      row[2] || differencePoints[index % differencePoints.length]
    ];
  });

  function exportCompareReport() {
    const content = [
      `政策对比报告：${currentPolicy.title}`,
      `发布日期：${currentPolicy.publishDate || "待补充"}`,
      "",
      "相似点：",
      ...similarityPoints.map((item) => `- ${item}`),
      "",
      "不同点：",
      ...differencePoints.map((item) => `- ${item}`),
      "",
      "维度矩阵：",
      ...displayedRows.map((row) => row.join(" | "))
    ].join("\n");
    downloadTextFile(buildFilename(currentPolicy.title, "compare"), content);
  }

  return (
    <div className="compare-layout">
      <section className="panel compare-main">
        <div className="panel-head">
          <div>
            <h2>对比分析</h2>
            <p>通过政策文本、条款与影响层面的多维对比，识别政策变化及潜在影响差异。</p>
          </div>
          <div className="toolbar">
            <button type="button" onClick={exportCompareReport}><Download size={15} /> 导出对比报告</button>
          </div>
        </div>
        <div className="analysis-note">
          当前版本暂不开放用户新增对比项；系统会基于已入库政策文本、条款、产业节点和证据链说明相似点与差异点。
        </div>
        <div className="compare-cards">
          <article>
            <span>当前政策（新）</span>
            <strong>{currentPolicy.title}</strong>
            <p>发布时间：{currentPolicy.publishDate || "待补充"}</p>
          </article>
          <GitCompareArrows size={22} />
          <article>
            <span>相似基准</span>
            <strong>官方政策原文 + 条款证据链</strong>
            <p>用于判断政策表达和证据来源是否一致</p>
          </article>
          <GitCompareArrows size={22} />
          <article>
            <span>差异基准</span>
            <strong>政策动作 + 产业节点 + 风险信号</strong>
            <p>用于判断本政策新增强调和缺口</p>
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
            <p className="empty-note">暂无可比政策矩阵。系统仍会基于当前政策条款、产业节点和证据链说明相似点与不同点。</p>
          ) : (
            displayedRows.map((row) => (
              <div className="matrix-row" key={row[0]}>
                {row.map((cell) => <span key={cell}>{cell}</span>)}
              </div>
            ))
          )}
        </div>
      </section>
      <aside className="panel compare-detail">
        <h2>对比项详情</h2>
        <h3>当前政策 vs 系统基准口径</h3>
        <section>
          <h4>条款对比</h4>
          <p>{currentClauses[0]?.excerpt || "当前政策尚未抽取到可对比条款。"}</p>
        </section>
        <section>
          <h4>影响行业</h4>
          <div className="tag-row">
            {(currentChainNodes.length ? currentChainNodes.slice(0, 6).map((node) => node.title) : ["尚未生成产业节点"]).map((item) => <span key={item}>{item}</span>)}
          </div>
        </section>
        <section>
          <h4>置信度评分</h4>
          <div className="score-band">
            <div>
              <span>综合置信度</span>
              <strong>{currentPolicy.confidence}<small>/100</small></strong>
            </div>
            <i><b style={{ width: `${currentPolicy.confidence}%` }} /></i>
            <p>证据 {currentEvidence.length} 条 · 条款 {currentClauses.length} 条 · 产业节点 {currentChainNodes.length} 个</p>
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
  const policyOriginalEvidence = currentEvidence.filter((item) => item.type.includes("政策原文")).length;

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
  const publishedReports = reports.filter((item) => item.status === "published");
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
          <p>这里是登录后的入口页。系统会按计划监测政府官网政策，自动生成可阅读的政策产业影响报表。</p>
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
            <p>政策由后台定时抓取并自动分析。普通用户只查看已发布报表，不能创建新的政策分析任务。</p>
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
                  ? "定时抓取与自动分析已接入云端数据源"
                  : repositoryMode === "mock"
                    ? "当前使用显式本地演示数据"
                    : "当前缺少 Supabase 前端配置"}
              </strong>
              <p>{repositoryMode === "supabase" ? "任务队列仅管理员可见；普通用户只消费已发布结果。" : "生产环境若缺少 Supabase 配置，不会回退到样例报表。"}</p>
            </div>
            <div className="job-progress">
              <span>{jobs.length > 0 ? `后台任务 ${jobs.length} 条` : "任务明细不可见"}</span>
              <b>{repositoryMode === "supabase" ? "自动" : repositoryMode === "mock" ? "演示" : "待配置"}</b>
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
        chainNodes={report ? report.chainNodes : chainNodes}
        clauses={report ? report.clauses : clauses}
        companies={report ? report.companies : companies}
        evidence={report ? report.evidence : evidence}
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

  const activeChainNodes = activeReport ? activeReport.chainNodes : chainNodes;
  const activeNode = useMemo(() => getNode(selectedNodeId, activeChainNodes) || activeChainNodes[0] || chainNodes[0], [activeChainNodes, selectedNodeId]);
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
    track({
      eventType: "navigate_back_to_list",
      policyRef: selectedReportId,
      moduleId: activeModule
    });
    setAppView("list");
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

  function resetSessionState() {
    setUser(null);
    setAppView("list");
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
            <p className="eyebrow">Policy Intelligence Terminal</p>
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
      <TopBar user={user} onLogout={logout} reports={reports} onOpenReport={openReport} repositoryMode={repositoryMode} />
      {appView === "report" && (
        <button className="mobile-menu-button" onClick={() => setMobileMenuOpen(true)}>
          <Menu size={18} />
          导航
        </button>
      )}
      {appView === "list" && (
        <PolicyListView reports={reports} jobs={jobs} error={workspaceError} onOpenReport={openReport} repositoryMode={repositoryMode} />
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
          {activeReport && activeReport.chainNodes.length > 0 && activeModule !== "brief" && activeModule !== "industry" && activeModule !== "companies" && (
            <aside className="context-rail">
              <NodeDetail
                node={activeNode}
                clauses={activeReport ? activeReport.clauses : clauses}
                companies={activeReport ? activeReport.companies : companies}
              />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
