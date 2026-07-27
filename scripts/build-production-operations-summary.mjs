#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { findDuplicateGroups } from "./lib/policy-identity.mjs";

const args = parseArgs(process.argv.slice(2));
const hourlyRuns = await readJson(args.hourlyRuns, []);
const currentInbox = await readJson(args.currentInbox, {});
const historicalInbox = await readJson(args.historicalInbox, {});
const registry = await readJson(args.registry, { reports: [] });
const generatedAt = new Date().toISOString();
const scheduledRuns = hourlyRuns
  .filter((item) => item.event === "schedule" && (!args.since || item.createdAt >= args.since))
  .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
let maxGapMinutes = 0;
for (let index = 1; index < scheduledRuns.length; index += 1) {
  maxGapMinutes = Math.max(maxGapMinutes, (Date.parse(scheduledRuns[index].createdAt) - Date.parse(scheduledRuns[index - 1].createdAt)) / 60_000);
}
const reports = Array.isArray(registry.reports) ? registry.reports : [];
const summary = {
  formatVersion: "production-operations-summary-v2",
  generatedAt,
  asOf: generatedAt,
  authority: {
    kind: "read_only_production_snapshot",
    repository: process.env.GITHUB_REPOSITORY ?? null,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    staticDocumentationIsRealtimeAuthority: false,
    note: "Dynamic counts are authoritative only for this immutable snapshot and its query windows."
  },
  queryWindows: {
    hourlyBaselineSince: args.since,
    currentInboxSince: currentInbox.sincePublishDate ?? null,
    historicalInboxSince: historicalInbox.sincePublishDate ?? null
  },
  hourlyCollection: {
    baselineSince: args.since,
    listedRuns: hourlyRuns.length,
    scheduledRuns: scheduledRuns.length,
    successfulScheduledRuns: scheduledRuns.filter((item) => item.conclusion === "success").length,
    latestScheduledRunId: scheduledRuns.at(-1)?.databaseId ?? null,
    latestScheduledRunAt: scheduledRuns.at(-1)?.createdAt ?? null,
    latestScheduledRunConclusion: scheduledRuns.at(-1)?.conclusion ?? null,
    maxObservedGapMinutes: Number(maxGapMinutes.toFixed(2))
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
console.log(`[operations:summary] asOf=${summary.asOf} run=${summary.authority.workflowRunId ?? "local"} scheduled=${summary.hourlyCollection.scheduledRuns} latest=${summary.hourlyCollection.latestScheduledRunAt} maxGap=${summary.hourlyCollection.maxObservedGapMinutes}m`);
console.log(`[operations:summary] currentInbox=${summary.currentInbox.total} historicalInbox=${summary.historicalInbox.total} duplicates=${summary.historicalInbox.duplicateGroupCount} attachmentPending=${summary.historicalInbox.attachmentEvidencePending} reports=${summary.reports.total}`);

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
    "> 本摘要是只读生产快照。动态数量以本文件的快照时间、查询窗口和工作流运行ID为准；静态状态文档不作为实时数量权威源。",
    "",
    "## 小时采集",
    "",
    `- 统计基线：${value.hourlyCollection.baselineSince ?? "全部历史"}；`,
    `- 已列出定时运行：${value.hourlyCollection.scheduledRuns}次；`,
    `- 成功：${value.hourlyCollection.successfulScheduledRuns}次；`,
    `- 最近运行：${value.hourlyCollection.latestScheduledRunAt ?? "无"}（run ${value.hourlyCollection.latestScheduledRunId ?? "无"}，${value.hourlyCollection.latestScheduledRunConclusion ?? "未知"}）；`,
    `- 最大观察间隔：${value.hourlyCollection.maxObservedGapMinutes}分钟。`,
    "",
    "## 候选收件箱",
    "",
    `- 当前窗口（自${value.currentInbox.sincePublishDate ?? "未知"}）：${value.currentInbox.total}项，待判断${value.currentInbox.pendingReview}，等待证据${value.currentInbox.awaitingEvidence}，已选择${value.currentInbox.selectedForAnalysis}；`,
    `- 历史全量（自${value.historicalInbox.sincePublishDate ?? "未知"}）：${value.historicalInbox.total}项，待判断${value.historicalInbox.pendingReview}，等待证据${value.historicalInbox.awaitingEvidence}，已选择${value.historicalInbox.selectedForAnalysis}；`,
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
    currentInbox: "artifacts/operations/current-inbox.json",
    historicalInbox: "artifacts/operations/historical-inbox.json",
    registry: "docs/manual-analysis/report-governance-registry-v1.0.json",
    outJson: "artifacts/operations/production-summary.json",
    outMarkdown: "artifacts/operations/production-summary.md",
    since: "2026-07-15T10:15:16Z"
  };
  for (const arg of argv) {
    if (arg.startsWith("--hourly-runs=")) parsed.hourlyRuns = arg.slice(14);
    else if (arg.startsWith("--current-inbox=")) parsed.currentInbox = arg.slice(16);
    else if (arg.startsWith("--historical-inbox=")) parsed.historicalInbox = arg.slice(19);
    else if (arg.startsWith("--registry=")) parsed.registry = arg.slice(11);
    else if (arg.startsWith("--out-json=")) parsed.outJson = arg.slice(11);
    else if (arg.startsWith("--out-markdown=")) parsed.outMarkdown = arg.slice(15);
    else if (arg.startsWith("--since=")) parsed.since = arg.slice(8);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/build-production-operations-summary.mjs [options]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
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
