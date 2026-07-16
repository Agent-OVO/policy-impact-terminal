#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const inbox = JSON.parse(await fs.readFile(path.resolve(args.input), "utf8"));
const registry = JSON.parse(await fs.readFile(path.resolve(args.registry), "utf8"));
const known = JSON.parse(await fs.readFile(path.resolve(args.known), "utf8"));
const governedTitles = new Map(
  (registry.reports ?? []).map((item) => [normalizeTitle(item.title), item])
);
const knownRules = new Map(
  (known.rules ?? []).map((item) => [normalizeTitle(item.title), item])
);
const policies = Array.isArray(inbox.policies) ? inbox.policies : [];
const rows = policies.map((policy) => classify(policy));
const counts = Object.fromEntries(
  [...new Set(rows.map((item) => item.category))].sort().map((category) => [category, rows.filter((item) => item.category === category).length])
);
const plan = {
  formatVersion: "manual-inbox-migration-plan-v1",
  generatedAt: new Date().toISOString(),
  input: {
    scanned: inbox.scanned ?? null,
    total: inbox.total ?? policies.length,
    returned: policies.length,
    since: args.currentSince
  },
  counts,
  recommendations: {
    safeWithoutFurtherResearch: rows.filter((item) => ["governed_report_exact", "known_quick_archive"].includes(item.category)).length,
    requiresIdReconciliation: rows.filter((item) => item.category === "known_local_result_requires_id_reconciliation").length,
    requiresAttachmentReview: rows.filter((item) => item.category === "likely_attachment_or_wrapper").length,
    genuinelyUnreviewed: rows.filter((item) => item.category === "historical_unreviewed").length,
    currentWindow: rows.filter((item) => item.category === "current_window_candidate").length
  },
  rows
};
await writeJson(args.outJson, plan);
await fs.mkdir(path.dirname(path.resolve(args.outMarkdown)), { recursive: true });
await fs.writeFile(path.resolve(args.outMarkdown), renderMarkdown(plan), "utf8");
console.log(`[inbox:migration-plan] rows=${rows.length} categories=${JSON.stringify(counts)}`);
console.log(`[inbox:migration-plan] safe=${plan.recommendations.safeWithoutFurtherResearch} reconcile=${plan.recommendations.requiresIdReconciliation} attachment=${plan.recommendations.requiresAttachmentReview} unreviewed=${plan.recommendations.genuinelyUnreviewed}`);
console.log(`[inbox:migration-plan] wrote ${path.resolve(args.outJson)} and ${path.resolve(args.outMarkdown)}`);

function classify(policy) {
  const normalized = normalizeTitle(policy.title);
  const governed = governedTitles.get(normalized);
  const knownRule = knownRules.get(normalized);
  let category;
  let recommendedDisposition = null;
  let reason = null;

  if (governed) {
    category = "governed_report_exact";
    recommendedDisposition = "dismissed";
    reason = `已有治理注册表正式报告 ${governed.policyId}，需核对是否为同一政策后关闭重复候选`;
  } else if (knownRule) {
    category = knownRule.category;
    recommendedDisposition = knownRule.recommendedDisposition ?? null;
    reason = knownRule.reason ?? "已有本地研究结果，需先完成生产政策ID对齐";
  } else if (policy.publishDate && policy.publishDate >= args.currentSince) {
    category = "current_window_candidate";
  } else if (isLikelyAttachmentWrapper(policy)) {
    category = "likely_attachment_or_wrapper";
    recommendedDisposition = "awaiting_evidence";
    reason = "正文较短且标题指向规划、办法、名单、目录或项目计划，需先核对PDF/OFD附件";
  } else {
    category = "historical_unreviewed";
  }

  return {
    id: policy.id,
    title: policy.title,
    publishDate: policy.publishDate,
    sourceName: policy.sourceName,
    sourceUrl: policy.sourceUrl,
    fullTextLength: policy.fullTextLength ?? 0,
    analysisDepth: policy.analysisDepth,
    reviewPriority: policy.reviewPriority ?? 0,
    currentDisposition: policy.manualReviewDisposition ?? "pending_review",
    category,
    recommendedDisposition,
    reason
  };
}

function isLikelyAttachmentWrapper(policy) {
  const length = Number(policy.fullTextLength ?? 0);
  if (length >= 1_200) return false;
  return /规划|办法|条例|意见|名单|目录|项目计划|裁量权基准|方案|标准/.test(policy.title ?? "");
}
function normalizeTitle(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/中华人民共和国|国务院办公厅关于转发|关于印发|的通知|的批复|通知|公告|令第?\d+号/g, "")
    .replace(/[《》“”"'\[\]【】()（）,，.。;；:：\-_—\s\u3000]/g, "")
    .trim();
}
function renderMarkdown(plan) {
  const lines = [
    "# 历史人工候选收件箱迁移计划",
    "",
    `生成时间：${plan.generatedAt}`,
    `候选数量：${plan.rows.length}`,
    "",
    "## 分类统计",
    "",
    "| 分类 | 数量 |",
    "|---|---:|",
    ...Object.entries(plan.counts).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "## 建议处置",
    "",
    `- 可在核对同一性后直接关闭或归档：${plan.recommendations.safeWithoutFurtherResearch}项；`,
    `- 需要本地研究结果与生产ID对齐：${plan.recommendations.requiresIdReconciliation}项；`,
    `- 需要附件补证：${plan.recommendations.requiresAttachmentReview}项；`,
    `- 真正未审阅历史政策：${plan.recommendations.genuinelyUnreviewed}项；`,
    `- 当前窗口新候选：${plan.recommendations.currentWindow}项。`,
    "",
    "## 明细",
    "",
    "| 日期 | 分类 | 标题 | 正文长度 | 建议状态 |",
    "|---|---|---|---:|---|",
    ...plan.rows.map((item) => `| ${item.publishDate ?? ""} | ${item.category} | ${escapeCell(item.title)} | ${item.fullTextLength} | ${item.recommendedDisposition ?? "待裁决"} |`),
    ""
  ];
  return lines.join("\n");
}
function escapeCell(value) { return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " "); }
function parseArgs(argv) {
  const parsed = {
    input: "artifacts/manual-analysis/pending-manual-analysis.json",
    registry: "docs/manual-analysis/report-governance-registry-v1.0.json",
    known: "docs/operations/historical-inbox-known-dispositions.json",
    currentSince: "2026-07-15",
    outJson: "artifacts/manual-analysis/historical-inbox-migration-plan.json",
    outMarkdown: "artifacts/manual-analysis/historical-inbox-migration-plan.md"
  };
  for (const arg of argv) {
    if (arg.startsWith("--input=")) parsed.input = arg.slice(8);
    else if (arg.startsWith("--registry=")) parsed.registry = arg.slice(11);
    else if (arg.startsWith("--known=")) parsed.known = arg.slice(8);
    else if (arg.startsWith("--current-since=")) parsed.currentSince = arg.slice(16);
    else if (arg.startsWith("--out-json=")) parsed.outJson = arg.slice(11);
    else if (arg.startsWith("--out-markdown=")) parsed.outMarkdown = arg.slice(15);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/plan-manual-inbox-migration.mjs --input=<pending-inbox.json>");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
async function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
