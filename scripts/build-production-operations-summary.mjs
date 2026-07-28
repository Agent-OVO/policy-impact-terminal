#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { findDuplicateGroups } from "./lib/policy-identity.mjs";

const args = parseArgs(process.argv.slice(2));
const hourlyRuns = await readJson(args.hourlyRuns, []);
const recoveryRuns = await readJson(args.recoveryRuns, []);
const livenessRuns = await readJson(args.livenessRuns, []);
const currentInbox = await readJson(args.currentInbox, {});
const historicalInbox = await readJson(args.historicalInbox, {});
const registry = await readJson(args.registry, { reports: [] });
const generatedAt = new Date().toISOString();
const asOf = args.asOf ?? generatedAt;

const scheduledRuns = hourlyRuns
  .filter((item) => item.event === "schedule" && (!args.since || timestampOf(item, "createdAt") >= Date.parse(args.since)))
  .sort(compareRunTime);
const successfulScheduledRuns = scheduledRuns.filter(isSuccessfulCompletedRun);
const successfulRecoveryRuns = recoveryRuns
  .filter(isSuccessfulCompletedRun)
  .sort(compareRunTime);
const performedRecoveryRuns = successfulRecoveryRuns
  .filter((item) => item.recoveryPerformed === true)
  .sort(compareRunTime);
const sortedLivenessRuns = [...livenessRuns].sort(compareRunTime);
const activeLivenessRuns = sortedLivenessRuns.filter((item) => ["queued", "in_progress", "pending", "waiting"].includes(item.status));

let maxGapMinutes = 0;
for (let index = 1; index < scheduledRuns.length; index += 1) {
  maxGapMinutes = Math.max(maxGapMinutes, minutesBetween(scheduledRuns[index - 1].createdAt, scheduledRuns[index].createdAt));
}

const effectiveRuns = [
  ...successfulScheduledRuns.map((item) => ({ ...item, effectiveKind: "scheduled" })),
  ...performedRecoveryRuns.map((item) => ({ ...item, effectiveKind: "recovery" }))
].sort(compareRunTime);
const latestEffectiveRun = effectiveRuns.at(-1) ?? null;
const effectiveAgeMinutes = latestEffectiveRun
  ? Math.max(0, minutesBetween(effectiveTimestamp(latestEffectiveRun), asOf))
  : null;
const collectionHealth = classifyCollectionHealth(effectiveAgeMinutes, args.freshnessThresholdMinutes);

const reports = Array.isArray(registry.reports) ? registry.reports : [];
const latestScheduledRun = scheduledRuns.at(-1) ?? null;
const latestSuccessfulScheduledRun = successfulScheduledRuns.at(-1) ?? null;
const latestRecoveryRun = [...recoveryRuns].sort(compareRunTime).at(-1) ?? null;
const latestPerformedRecoveryRun = performedRecoveryRuns.at(-1) ?? null;
const latestLivenessRun = sortedLivenessRuns.at(-1) ?? null;
const latestActiveLivenessRun = activeLivenessRuns.at(-1) ?? null;

const summary = {
  formatVersion: "production-operations-summary-v3",
  generatedAt,
  asOf,
  authority: {
    kind: "read_only_production_snapshot",
    repository: process.env.GITHUB_REPOSITORY ?? null,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    staticDocumentationIsRealtimeAuthority: false,
    note: "Dynamic counts and collection freshness are authoritative only for this immutable snapshot and its query windows."
  },
  queryWindows: {
    hourlyBaselineSince: args.since,
    currentInboxSince: currentInbox.sincePublishDate ?? null,
    historicalInboxSince: historicalInbox.sincePublishDate ?? null
  },
  collectionHealth: {
    status: collectionHealth,
    freshnessThresholdMinutes: args.freshnessThresholdMinutes,
    staleThresholdMinutes: args.freshnessThresholdMinutes * 2,
    latestEffectiveRunId: latestEffectiveRun?.databaseId ?? null,
    latestEffectiveRunKind: latestEffectiveRun?.effectiveKind ?? null,
    latestEffectiveRunAt: latestEffectiveRun ? effectiveTimestamp(latestEffectiveRun) : null,
    latestEffectiveRunConclusion: latestEffectiveRun?.conclusion ?? null,
    effectiveAgeMinutes: effectiveAgeMinutes === null ? null : Number(effectiveAgeMinutes.toFixed(2)),
    recoveryBacked: latestEffectiveRun?.effectiveKind === "recovery",
    interpretation: collectionHealthInterpretation(collectionHealth, latestEffectiveRun?.effectiveKind ?? null)
  },
  hourlyCollection: {
    baselineSince: args.since,
    listedRuns: hourlyRuns.length,
    scheduledRuns: scheduledRuns.length,
    successfulScheduledRuns: successfulScheduledRuns.length,
    latestScheduledRunId: latestScheduledRun?.databaseId ?? null,
    latestScheduledRunAt: latestScheduledRun?.createdAt ?? null,
    latestScheduledRunConclusion: latestScheduledRun?.conclusion ?? null,
    latestSuccessfulScheduledRunId: latestSuccessfulScheduledRun?.databaseId ?? null,
    latestSuccessfulScheduledRunAt: latestSuccessfulScheduledRun ? effectiveTimestamp(latestSuccessfulScheduledRun) : null,
    maxObservedScheduledGapMinutes: Number(maxGapMinutes.toFixed(2)),
    note: "Scheduled-run gaps describe GitHub schedule delivery only and do not by themselves prove a collection outage."
  },
  recoveryCollection: {
    listedRuns: recoveryRuns.length,
    successfulRuns: successfulRecoveryRuns.length,
    annotatedSuccessfulRuns: successfulRecoveryRuns.filter((item) => typeof item.recoveryPerformed === "boolean").length,
    performedRuns: performedRecoveryRuns.length,
    latestRunId: latestRecoveryRun?.databaseId ?? null,
    latestRunAt: latestRecoveryRun ? effectiveTimestamp(latestRecoveryRun) : null,
    latestRunStatus: latestRecoveryRun?.status ?? null,
    latestRunConclusion: latestRecoveryRun?.conclusion ?? null,
    latestPerformedRunId: latestPerformedRecoveryRun?.databaseId ?? null,
    latestPerformedRunAt: latestPerformedRecoveryRun ? effectiveTimestamp(latestPerformedRecoveryRun) : null
  },
  remoteLiveness: {
    listedRuns: livenessRuns.length,
    activeRuns: activeLivenessRuns.length,
    latestRunId: latestLivenessRun?.databaseId ?? null,
    latestRunAt: latestLivenessRun ? effectiveTimestamp(latestLivenessRun) : null,
    latestRunStatus: latestLivenessRun?.status ?? null,
    latestRunConclusion: latestLivenessRun?.conclusion ?? null,
    latestActiveRunId: latestActiveLivenessRun?.databaseId ?? null,
    latestActiveRunAt: latestActiveLivenessRun ? effectiveTimestamp(latestActiveLivenessRun) : null,
    active: Boolean(latestActiveLivenessRun)
  },
  currentInbox: normalizeInbox(currentInbox),
  historicalInbox: normalizeInbox(historicalInbox),
  reports: {
    total: reports.length,
    full: reports.filter((item) => item.migrationStatus === "full").length,
    light: reports.filter((item) => item.migrationStatus === "light").length,
    categories: Object.fromEntries(["A", "B", "C"].map((category) => [category, reports.filter((item) => item.category === category).length]))
  }
};

await writeJson(args.outJson, summary);
await fs.mkdir(path.dirname(path.resolve(args.outMarkdown)), { recursive: true });
await fs.writeFile(path.resolve(args.outMarkdown), renderMarkdown(summary), "utf8");
console.log(`[operations:summary] asOf=${summary.asOf} run=${summary.authority.workflowRunId ?? "local"} health=${summary.collectionHealth.status} effective=${summary.collectionHealth.latestEffectiveRunKind ?? "none"}:${summary.collectionHealth.latestEffectiveRunId ?? "none"} age=${summary.collectionHealth.effectiveAgeMinutes ?? "unknown"}m`);
console.log(`[operations:summary] scheduled=${summary.hourlyCollection.scheduledRuns} latestScheduled=${summary.hourlyCollection.latestScheduledRunAt} maxScheduledGap=${summary.hourlyCollection.maxObservedScheduledGapMinutes}m recoveryPerformed=${summary.recoveryCollection.performedRuns} livenessActive=${summary.remoteLiveness.active}`);
console.log(`[operations:summary] currentInbox=${summary.currentInbox.total} historicalInbox=${summary.historicalInbox.total} staleOpenJobs=${summary.historicalInbox.staleOpenAnalysisJobs} stalePolicies=${summary.historicalInbox.policiesWithStaleOpenAnalysisJobs} duplicates=${summary.historicalInbox.duplicateGroupCount} attachmentPending=${summary.historicalInbox.attachmentEvidencePending} reports=${summary.reports.total}`);

function normalizeInbox(value) {
  const policies = Array.isArray(value?.policies) ? value.policies : [];
  const stateCounts = value?.stateCounts ?? {};
  const duplicateGroups = findDuplicateGroups(policies);
  const attachmentPending = policies.filter((policy) =>
    policy.manualReviewDisposition === "awaiting_evidence" &&
    /附件|pdf|ofd|doc|docx|xls|xlsx|ppt|pptx|正文|下载/i.test(policy.manualReviewReason ?? "")
  );
  return {
    asOf: value?.generatedAt ?? value?.asOf ?? null,
    sincePublishDate: value?.sincePublishDate ?? null,
    scanned: value?.scanned ?? null,
    total: value?.total ?? value?.count ?? 0,
    returned: value?.count ?? policies.length,
    pendingReview: stateCounts.pendingReview ?? policies.filter((item) => item.manualReviewDisposition === "pending_review").length,
    awaitingEvidence: stateCounts.awaitingEvidence ?? policies.filter((item) => item.manualReviewDisposition === "awaiting_evidence").length,
    selectedForAnalysis: stateCounts.selectedForAnalysis ?? policies.filter((item) => item.manualReviewDisposition === "selected_for_analysis").length,
    totalOpenAnalysisJobs: stateCounts.totalOpenAnalysisJobs ?? policies.reduce((total, item) => total + Number(item.openAnalysisJobCount ?? 0), 0),
    policiesWithOpenAnalysisJobs: stateCounts.policiesWithOpenAnalysisJobs ?? policies.filter((item) => Number(item.openAnalysisJobCount ?? 0) > 0).length,
    staleOpenAnalysisJobs: stateCounts.staleOpenAnalysisJobs ?? policies.reduce((total, item) => total + Number(item.staleOpenAnalysisJobCount ?? 0), 0),
    policiesWithStaleOpenAnalysisJobs: stateCounts.policiesWithStaleOpenAnalysisJobs ?? policies.filter((item) => Number(item.staleOpenAnalysisJobCount ?? 0) > 0).length,
    attachmentEvidencePending: attachmentPending.length,
    duplicateGroupCount: duplicateGroups.length,
    exactUrlDuplicateGroupCount: duplicateGroups.filter((group) => group.reasons.includes("exact-url")).length,
    semanticDuplicateGroupCount: duplicateGroups.filter((group) => group.reasons.some((reason) => ["policy-no", "document-title-date"].includes(reason))).length,
    duplicateGroups: duplicateGroups.map((group) => ({
      reasons: group.reasons,
      matchedKeys: group.matchedKeys,
      policies: group.policies.map((policy) => ({
        id: policy.id,
        title: policy.title,
        publishDate: policy.publishDate,
        sourceUrl: policy.sourceUrl,
        fullTextLength: policy.fullTextLength ?? 0,
        manualReviewDisposition: policy.manualReviewDisposition ?? null
      }))
    })),
    attachmentEvidencePolicies: attachmentPending.map((policy) => ({
      id: policy.id,
      title: policy.title,
      publishDate: policy.publishDate,
      sourceUrl: policy.sourceUrl,
      reason: policy.manualReviewReason
    }))
  };
}

function renderMarkdown(value) {
  return [
    "# 政策解析终端生产运行摘要",
    "",
    `快照时间：${value.asOf}`,
    `工作流运行：${value.authority.workflowRunId ?? "本地生成"}`,
    "",
    "> 本摘要是只读生产快照。动态数量和有效采集新鲜度以本文件的快照时间、查询窗口和工作流运行ID为准；静态状态文档不作为实时权威源。",
    "",
    "## 有效采集健康度",
    "",
    `- 状态：${value.collectionHealth.status}；`,
    `- 最近有效采集：${value.collectionHealth.latestEffectiveRunAt ?? "无"}（${value.collectionHealth.latestEffectiveRunKind ?? "未知"}，run ${value.collectionHealth.latestEffectiveRunId ?? "无"}）；`,
    `- 距快照：${value.collectionHealth.effectiveAgeMinutes ?? "未知"}分钟；健康阈值${value.collectionHealth.freshnessThresholdMinutes}分钟，陈旧阈值${value.collectionHealth.staleThresholdMinutes}分钟；`,
    `- 判读：${value.collectionHealth.interpretation}`,
    "",
    "## 主定时采集",
    "",
    `- 统计基线：${value.hourlyCollection.baselineSince ?? "全部历史"}；`,
    `- 已列出定时运行：${value.hourlyCollection.scheduledRuns}次，成功${value.hourlyCollection.successfulScheduledRuns}次；`,
    `- 最近定时运行：${value.hourlyCollection.latestScheduledRunAt ?? "无"}（run ${value.hourlyCollection.latestScheduledRunId ?? "无"}，${value.hourlyCollection.latestScheduledRunConclusion ?? "未知"}）；`,
    `- 最大主定时间隔：${value.hourlyCollection.maxObservedScheduledGapMinutes}分钟。该指标仅描述GitHub定时投递，不单独等同于采集中断。`,
    "",
    "## 恢复链与远程存活链",
    "",
    `- 恢复工作流：列出${value.recoveryCollection.listedRuns}次，成功${value.recoveryCollection.successfulRuns}次，确认实际补采${value.recoveryCollection.performedRuns}次；`,
    `- 最近实际补采：${value.recoveryCollection.latestPerformedRunAt ?? "无"}（run ${value.recoveryCollection.latestPerformedRunId ?? "无"}）；`,
    `- 远程存活链：最近状态${value.remoteLiveness.latestRunStatus ?? "未知"}，当前活动${value.remoteLiveness.active ? "是" : "否"}${value.remoteLiveness.latestActiveRunId ? `（run ${value.remoteLiveness.latestActiveRunId}）` : ""}。`,
    "",
    "## 候选收件箱",
    "",
    `- 当前窗口（自${value.currentInbox.sincePublishDate ?? "未知"}）：${value.currentInbox.total}项，待判断${value.currentInbox.pendingReview}，等待证据${value.currentInbox.awaitingEvidence}，已选择${value.currentInbox.selectedForAnalysis}；`,
    `- 历史全量（自${value.historicalInbox.sincePublishDate ?? "未知"}）：${value.historicalInbox.total}项，待判断${value.historicalInbox.pendingReview}，等待证据${value.historicalInbox.awaitingEvidence}，已选择${value.historicalInbox.selectedForAnalysis}；`,
    `- 开放分析任务：当前窗口${value.currentInbox.totalOpenAnalysisJobs}个，其中非已选择状态的陈旧任务${value.currentInbox.staleOpenAnalysisJobs}个、涉及${value.currentInbox.policiesWithStaleOpenAnalysisJobs}项；历史全量陈旧任务${value.historicalInbox.staleOpenAnalysisJobs}个、涉及${value.historicalInbox.policiesWithStaleOpenAnalysisJobs}项。处置这些候选前必须显式确认关闭对应政策的开放任务；`,
    `- 历史重复完整性组：${value.historicalInbox.duplicateGroupCount}组，其中同URL ${value.historicalInbox.exactUrlDuplicateGroupCount}组，政策号/核心标题语义重复 ${value.historicalInbox.semanticDuplicateGroupCount}组；`,
    `- 附件正文待证：${value.historicalInbox.attachmentEvidencePending}项。`,
    "",
    "## 正式报告",
    "",
    `- 合计${value.reports.total}份，完整${value.reports.full}份，轻量${value.reports.light}份；`,
    `- A类${value.reports.categories.A}，B类${value.reports.categories.B}，C类${value.reports.categories.C}。`,
    ""
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {
    hourlyRuns: "artifacts/operations/hourly-runs.json",
    recoveryRuns: "artifacts/operations/recovery-runs-annotated.json",
    livenessRuns: "artifacts/operations/liveness-runs.json",
    currentInbox: "artifacts/operations/current-inbox.json",
    historicalInbox: "artifacts/operations/historical-inbox.json",
    registry: "docs/manual-analysis/report-governance-registry-v1.0.json",
    outJson: "artifacts/operations/production-summary.json",
    outMarkdown: "artifacts/operations/production-summary.md",
    since: "2026-07-15T10:15:16Z",
    asOf: null,
    freshnessThresholdMinutes: 80
  };
  for (const arg of argv) {
    if (arg.startsWith("--hourly-runs=")) parsed.hourlyRuns = arg.slice(14);
    else if (arg.startsWith("--recovery-runs=")) parsed.recoveryRuns = arg.slice(16);
    else if (arg.startsWith("--liveness-runs=")) parsed.livenessRuns = arg.slice(16);
    else if (arg.startsWith("--current-inbox=")) parsed.currentInbox = arg.slice(16);
    else if (arg.startsWith("--historical-inbox=")) parsed.historicalInbox = arg.slice(19);
    else if (arg.startsWith("--registry=")) parsed.registry = arg.slice(11);
    else if (arg.startsWith("--out-json=")) parsed.outJson = arg.slice(11);
    else if (arg.startsWith("--out-markdown=")) parsed.outMarkdown = arg.slice(15);
    else if (arg.startsWith("--since=")) parsed.since = arg.slice(8);
    else if (arg.startsWith("--as-of=")) parsed.asOf = requireIsoTimestamp(arg.slice(8), "as-of");
    else if (arg.startsWith("--freshness-threshold-minutes=")) parsed.freshnessThresholdMinutes = requirePositiveNumber(arg.slice(30), "freshness-threshold-minutes");
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/build-production-operations-summary.mjs [options]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.since) requireIsoTimestamp(parsed.since, "since");
  return parsed;
}

function classifyCollectionHealth(ageMinutes, thresholdMinutes) {
  if (ageMinutes === null) return "unknown";
  if (ageMinutes <= thresholdMinutes) return "healthy";
  if (ageMinutes <= thresholdMinutes * 2) return "degraded";
  return "stale";
}

function collectionHealthInterpretation(status, kind) {
  if (status === "healthy" && kind === "recovery") return "恢复链已完成补采，终端有效采集保持新鲜；主定时延迟不等于生产中断。";
  if (status === "healthy") return "主定时或恢复采集在健康阈值内完成，终端有效采集正常。";
  if (status === "degraded") return "最近有效采集已超过健康阈值，但尚未达到陈旧阈值，应检查主定时和恢复链。";
  if (status === "stale") return "最近有效采集已超过陈旧阈值，应视为生产采集异常并立即处置。";
  return "没有可确认的成功主定时或实际恢复采集，无法判断生产新鲜度。";
}

function effectiveTimestamp(item) {
  return item?.updatedAt ?? item?.createdAt ?? null;
}

function compareRunTime(a, b) {
  return timestampOf(a) - timestampOf(b);
}

function timestampOf(item, preferredField = null) {
  const value = preferredField ? item?.[preferredField] : effectiveTimestamp(item);
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function minutesBetween(from, to) {
  const fromTimestamp = Date.parse(from ?? "");
  const toTimestamp = Date.parse(to ?? "");
  if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)) return 0;
  return (toTimestamp - fromTimestamp) / 60_000;
}

function isSuccessfulCompletedRun(item) {
  return item?.status === "completed" && item?.conclusion === "success";
}

function requireIsoTimestamp(value, name) {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`--${name} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function requirePositiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive number`);
  return parsed;
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
