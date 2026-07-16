#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const hourlyRuns = await readJson(args.hourlyRuns, []);
const currentInbox = await readJson(args.currentInbox, {});
const historicalInbox = await readJson(args.historicalInbox, {});
const registry = await readJson(args.registry, { reports: [] });
const scheduledRuns = hourlyRuns
  .filter((item) => item.event === "schedule" && (!args.since || item.createdAt >= args.since))
  .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
let maxGapMinutes = 0;
for (let index = 1; index < scheduledRuns.length; index += 1) {
  maxGapMinutes = Math.max(maxGapMinutes, (Date.parse(scheduledRuns[index].createdAt) - Date.parse(scheduledRuns[index - 1].createdAt)) / 60_000);
}
const reports = Array.isArray(registry.reports) ? registry.reports : [];
const summary = {
  formatVersion: "production-operations-summary-v1",
  generatedAt: new Date().toISOString(),
  hourlyCollection: {
    baselineSince: args.since,
    listedRuns: hourlyRuns.length,
    scheduledRuns: scheduledRuns.length,
    successfulScheduledRuns: scheduledRuns.filter((item) => item.conclusion === "success").length,
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
console.log(`[operations:summary] scheduled=${summary.hourlyCollection.scheduledRuns} latest=${summary.hourlyCollection.latestScheduledRunAt} maxGap=${summary.hourlyCollection.maxObservedGapMinutes}m`);
console.log(`[operations:summary] currentInbox=${summary.currentInbox.total} historicalInbox=${summary.historicalInbox.total} reports=${summary.reports.total}`);

function normalizeInbox(value) {
  const stateCounts = value?.stateCounts ?? {};
  return {
    scanned: value?.scanned ?? null,
    total: value?.total ?? value?.count ?? 0,
    returned: value?.count ?? 0,
    pendingReview: stateCounts.pendingReview ?? 0,
    awaitingEvidence: stateCounts.awaitingEvidence ?? 0,
    selectedForAnalysis: stateCounts.selectedForAnalysis ?? 0
  };
}
function renderMarkdown(value) {
  return [
    "# 政策解析终端生产运行摘要",
    "",
    `生成时间：${value.generatedAt}`,
    "",
    "## 小时采集",
    "",
    `- 统计基线：${value.hourlyCollection.baselineSince ?? "全部历史"}；`,
    `- 已列出定时运行：${value.hourlyCollection.scheduledRuns}次；`,
    `- 成功：${value.hourlyCollection.successfulScheduledRuns}次；`,
    `- 最近运行：${value.hourlyCollection.latestScheduledRunAt ?? "无"}（${value.hourlyCollection.latestScheduledRunConclusion ?? "未知"}）；`,
    `- 最大观察间隔：${value.hourlyCollection.maxObservedGapMinutes}分钟。`,
    "",
    "## 候选收件箱",
    "",
    `- 当前窗口：${value.currentInbox.total}项，待判断${value.currentInbox.pendingReview}，等待证据${value.currentInbox.awaitingEvidence}，已选择${value.currentInbox.selectedForAnalysis}；`,
    `- 历史全量：${value.historicalInbox.total}项，待判断${value.historicalInbox.pendingReview}，等待证据${value.historicalInbox.awaitingEvidence}，已选择${value.historicalInbox.selectedForAnalysis}。`,
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
