#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fetchOfficialPolicySource } from "./lib/official-policy-source.mjs";

const args = parseArgs(process.argv.slice(2));
const registry = JSON.parse(await fs.readFile(path.resolve(args.registry), "utf8"));
if (!Array.isArray(registry.reports)) {
  throw new Error("Governance registry must contain a reports array.");
}

const documents = [];
const errors = [];
for (const [index, item] of registry.reports.entries()) {
  const policyId = String(item.policyId ?? "").trim();
  const reportPath = path.resolve(args.reportsDir, `${policyId}.json`);
  try {
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    const policy = report.policy && typeof report.policy === "object" ? report.policy : {};
    const sourceUrl = firstString(policy.sourceUrl, policy.source_url);
    if (!sourceUrl) throw new Error("report policy sourceUrl is missing");

    const document = await fetchOfficialPolicySource({
      policyId,
      sourceUrl,
      title: firstString(policy.title, report.summary?.title, item.title),
      issuer: firstString(policy.issuer, report.summary?.issuer),
      sourceName: firstString(policy.source, report.summary?.source),
      officialPublishedAt: toOfficialPublishedAt(firstString(policy.publishDate, report.summary?.publishDate)),
      evidenceExcerpts: policyEvidenceExcerpts(report)
    }, {
      timeoutMs: args.timeoutMs,
      retries: args.retries
    });
    documents.push(document);
    console.log(
      `[stage7:source-fetch] ${index + 1}/${registry.reports.length} ${policyId} ` +
      `length=${document.fullText.length} selector=${document.metadata.selectedSelector} ` +
      `attachments=${document.metadata.attachments.length} status=${document.metadata.verificationStatus} ` +
      `evidence=${document.metadata.evidenceValidation.matchedCount}/${document.metadata.evidenceValidation.excerptCount}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ policyId, reportPath, message });
    console.error(`[stage7:source-fetch] ${index + 1}/${registry.reports.length} ${policyId} failed: ${message}`);
  }
}

const output = {
  formatVersion: "stage7-official-source-candidate-v1",
  exportedAt: new Date().toISOString(),
  verificationStatus: "official_url_pending_production_crosscheck",
  counts: {
    expected: registry.reports.length,
    documents: documents.length,
    errors: errors.length,
    verified: documents.filter((item) => item.metadata.verificationStatus === "official_source_verified").length,
    candidates: documents.filter((item) => item.metadata.verificationStatus !== "official_source_verified").length,
    attachmentReviewRequired: documents.filter((item) => item.metadata.attachmentReviewRequired).length,
    fallbackBodyUsed: documents.filter((item) => item.metadata.diagnostics?.fallbackBodyUsed).length
  },
  documents,
  errors
};

await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
await fs.writeFile(path.resolve(args.out), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[stage7:source-fetch] wrote ${documents.length}/${registry.reports.length} documents to ${path.resolve(args.out)}`);

if (args.requireAll && errors.length > 0) {
  throw new Error(`Official source fetch completed with ${errors.length} error(s).`);
}

function parseArgs(argv) {
  const parsed = {
    registry: "docs/manual-analysis/report-governance-registry-v1.0.json",
    reportsDir: "manual-reports",
    out: "artifacts/stage7/official-source-documents.json",
    timeoutMs: 30_000,
    retries: 2,
    requireAll: false
  };
  for (const arg of argv) {
    if (arg.startsWith("--registry=")) parsed.registry = arg.slice("--registry=".length);
    else if (arg.startsWith("--reports-dir=")) parsed.reportsDir = arg.slice("--reports-dir=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg.startsWith("--timeout-ms=")) parsed.timeoutMs = positiveInteger(arg.slice("--timeout-ms=".length), parsed.timeoutMs);
    else if (arg.startsWith("--retries=")) parsed.retries = nonNegativeInteger(arg.slice("--retries=".length), parsed.retries);
    else if (arg === "--require-all") parsed.requireAll = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/fetch-stage7-official-source-documents.mjs [options]\n\n` +
        `  --registry=<path>\n` +
        `  --reports-dir=<path>\n` +
        `  --out=<path>\n` +
        `  --timeout-ms=<n>\n` +
        `  --retries=<n>\n` +
        `  --require-all\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toOfficialPublishedAt(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? `${value}T00:00:00+08:00` : null;
}

function policyEvidenceExcerpts(report) {
  const evidence = Array.isArray(report.evidence) ? report.evidence : [];
  return evidence
    .filter((item) => {
      const type = String(item?.type ?? item?.evidenceType ?? item?.evidence_type ?? "").toLowerCase();
      return type === "policy_text" || type === "policy" || type === "official_policy";
    })
    .map((item) => firstString(item.excerpt, item.quote, item.text))
    .filter(Boolean);
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function nonNegativeInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}
