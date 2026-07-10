#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const sourceExport = JSON.parse(await fs.readFile(path.resolve(args.sourceDocuments), "utf8"));
const registry = JSON.parse(await fs.readFile(path.resolve(args.registry), "utf8"));
const documents = Array.isArray(sourceExport.documents) ? sourceExport.documents : [];
const titleById = new Map((registry.reports ?? []).map((item) => [String(item.policyId), String(item.title ?? "")]));

const reports = documents.map((document) => {
  const validation = document.metadata?.evidenceValidation ?? {};
  const rows = Array.isArray(validation.rows) ? validation.rows : [];
  const matchRatio = validation.excerptCount > 0 ? validation.matchedCount / validation.excerptCount : null;
  return {
    policyId: document.policyId,
    title: titleById.get(document.policyId) ?? document.metadata?.title ?? "",
    sourceTextHash: document.metadata?.sourceTextHash ?? null,
    verificationStatus: document.metadata?.verificationStatus ?? "unknown",
    evidence: {
      excerptCount: Number(validation.excerptCount ?? 0),
      matchedCount: Number(validation.matchedCount ?? 0),
      exactCount: Number(validation.exactCount ?? 0),
      compressedCount: Number(validation.compressedCount ?? 0),
      relatedButNotQuotedCount: Number(validation.relatedButNotQuotedCount ?? 0),
      notLocatedCount: rows.filter((item) => item.matchType === "not_located").length,
      matchRatio: matchRatio === null ? null : Number(matchRatio.toFixed(3)),
      status: validation.excerptCount === 0
        ? "no_policy_text_excerpt"
        : matchRatio >= args.threshold
          ? "pass"
          : "review_required",
      unmatchedExcerptHashes: rows
        .filter((item) => !item.matched)
        .map((item) => sha256(String(item.excerpt ?? "")))
    }
  };
}).sort((left, right) => left.policyId.localeCompare(right.policyId));

const summary = {
  reports: reports.length,
  verifiedSources: reports.filter((item) => item.verificationStatus === "official_source_verified").length,
  reportsWithEvidenceExcerpts: reports.filter((item) => item.evidence.excerptCount > 0).length,
  reportsWithoutEvidenceExcerpts: reports.filter((item) => item.evidence.excerptCount === 0).length,
  reviewRequiredReports: reports.filter((item) => item.evidence.status === "review_required").length,
  excerpts: sum(reports, "excerptCount"),
  matched: sum(reports, "matchedCount"),
  exact: sum(reports, "exactCount"),
  compressed: sum(reports, "compressedCount"),
  relatedButNotQuoted: sum(reports, "relatedButNotQuotedCount"),
  notLocated: sum(reports, "notLocatedCount")
};

const output = {
  formatVersion: "stage7-source-evidence-audit-v1",
  threshold: args.threshold,
  sourceExportFormat: sourceExport.formatVersion ?? null,
  sourceExportedAt: sourceExport.exportedAt ?? null,
  summary,
  reports
};

await writeFile(args.out, `${JSON.stringify(output, null, 2)}\n`);
await writeFile(args.markdownOut, renderMarkdown(output));
console.log(`[stage7:evidence-audit] verifiedSources=${summary.verifiedSources}/${summary.reports}`);
console.log(`[stage7:evidence-audit] excerpts=${summary.excerpts} exact=${summary.exact} compressed=${summary.compressed} related=${summary.relatedButNotQuoted} notLocated=${summary.notLocated}`);
console.log(`[stage7:evidence-audit] reviewRequiredReports=${summary.reviewRequiredReports}`);
console.log(`[stage7:evidence-audit] wrote ${path.resolve(args.out)} and ${path.resolve(args.markdownOut)}`);

function renderMarkdown(audit) {
  const review = audit.reports.filter((item) => item.evidence.status === "review_required");
  const rows = review.map((item) =>
    `| ${item.policyId} | ${escapeCell(item.title)} | ${item.evidence.matchedCount}/${item.evidence.excerptCount} | ${item.evidence.exactCount} | ${item.evidence.compressedCount} | ${item.evidence.relatedButNotQuotedCount} | ${item.evidence.notLocatedCount} |`
  ).join("\n");
  return `# 阶段七官方原文与证据摘录审计\n\n` +
    `- 官方来源验证：${audit.summary.verifiedSources}/${audit.summary.reports}\n` +
    `- 标为政策原文的摘录：${audit.summary.excerpts}\n` +
    `- 逐字匹配：${audit.summary.exact}\n` +
    `- 压缩摘录匹配：${audit.summary.compressed}\n` +
    `- 仅语义相关：${audit.summary.relatedButNotQuoted}\n` +
    `- 无法定位：${audit.summary.notLocated}\n` +
    `- 需复核报告：${audit.summary.reviewRequiredReports}\n\n` +
    `| Policy ID | 报告 | 匹配 | 逐字 | 压缩 | 仅相关 | 未定位 |\n` +
    `|---|---|---:|---:|---:|---:|---:|\n${rows || "| - | 无 | - | - | - | - | - |"}\n`;
}

function parseArgs(argv) {
  const parsed = {
    sourceDocuments: "artifacts/stage7/official-source-documents.json",
    registry: "docs/manual-analysis/report-governance-registry-v1.0.json",
    out: "artifacts/stage7/source-evidence-audit.json",
    markdownOut: "artifacts/stage7/source-evidence-audit.md",
    threshold: 0.6
  };
  for (const arg of argv) {
    if (arg.startsWith("--source-documents=")) parsed.sourceDocuments = arg.slice("--source-documents=".length);
    else if (arg.startsWith("--registry=")) parsed.registry = arg.slice("--registry=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg.startsWith("--markdown-out=")) parsed.markdownOut = arg.slice("--markdown-out=".length);
    else if (arg.startsWith("--threshold=")) parsed.threshold = Number(arg.slice("--threshold=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(parsed.threshold) || parsed.threshold < 0 || parsed.threshold > 1) {
    throw new Error("--threshold must be between 0 and 1.");
  }
  return parsed;
}

function sum(reports, field) {
  return reports.reduce((total, item) => total + Number(item.evidence[field] ?? 0), 0);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

async function writeFile(filePath, content) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");
}
