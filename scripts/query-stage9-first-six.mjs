#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MANIFEST = "research-batches/stage9-first-six/batch-manifest.json";

export async function loadFirstSixBatch(root = process.cwd(), manifestPath = DEFAULT_MANIFEST) {
  const absoluteManifest = path.resolve(root, manifestPath);
  const manifest = JSON.parse(await fs.readFile(absoluteManifest, "utf8"));
  const policies = [];

  for (const item of manifest.policies ?? []) {
    const absoluteReport = path.resolve(root, item.reportPath);
    const report = JSON.parse(await fs.readFile(absoluteReport, "utf8"));
    policies.push({ manifest: item, report, reportPath: item.reportPath });
  }

  return { manifest, policies };
}

export function buildFirstSixResearchIndex(batch) {
  const policyIndex = [];
  const industryIndex = [];
  const companyIndex = [];

  for (const entry of batch.policies) {
    const { manifest, report, reportPath } = entry;
    const title = report.policy?.title ?? report.summary?.title ?? manifest.title;
    const policyKey = manifest.policyKey ?? manifest.policyTool ?? manifest.sampleRole ?? title;
    const nodeById = new Map((report.chainNodes ?? []).map((node) => [node.id, node]));
    const companyMapById = new Map((report.companyMap ?? []).map((item) => [item.companyId, item]));

    policyIndex.push({
      title,
      policyKey,
      reportPath,
      reportDepth: manifest.reportDepth,
      analysisDepth: report.analysisDepth,
      policySignalStrength: report.policySignalStrength,
      implementationCertainty: report.implementationCertainty,
      primaryActionType: report.primaryActionType,
      sourceUrl: report.policy?.sourceUrl ?? manifest.sourceUrl,
      judgement: report.brief?.judgement ?? "",
      followUpSignals: report.followUpSignals ?? []
    });

    for (const relation of report.policyIndustryMap ?? []) {
      industryIndex.push({
        industry: relation.industry,
        policyTitle: title,
        policyTool: policyKey,
        reportPath,
        policyAction: relation.policyAction,
        impactType: relation.impactType,
        impactDirection: relation.impactDirection,
        evidenceLevel: relation.evidenceLevel,
        policyCloseness: relation.policyCloseness,
        reason: relation.reason,
        watchSignals: relation.watchSignals ?? [],
        relatedNodes: (relation.relatedNodeIds ?? []).map((id) => nodeById.get(id)?.title ?? id)
      });
    }

    for (const company of report.companies ?? []) {
      const mapping = companyMapById.get(company.id) ?? {};
      companyIndex.push({
        company: company.name,
        ticker: company.ticker ?? "",
        policyTitle: title,
        policyTool: policyKey,
        reportPath,
        relationship: mapping.relationship ?? company.mappingLevel ?? company.relation ?? "",
        policyEvidence: mapping.policyEvidence ?? company.companyMappingEvidenceLevel ?? company.evidenceLevel ?? "",
        officialMention: Boolean(company.officialMention),
        businessExposure: mapping.businessExposure ?? company.reason ?? "",
        investmentUse: mapping.investmentUse ?? "",
        uncertainty: company.uncertainty ?? company.riskNote ?? "",
        keyRisks: mapping.keyRisks ?? company.riskFactors ?? [],
        watchSignals: mapping.watchSignals ?? [],
        relatedNodes: (company.nodeIds ?? []).map((id) => nodeById.get(id)?.title ?? id)
      });
    }
  }

  return { policyIndex, industryIndex, companyIndex };
}

export function queryFirstSixIndex(index, type, query = "") {
  const normalized = normalize(query);
  if (type === "summary") {
    return {
      policyCount: index.policyIndex.length,
      industryRelationCount: index.industryIndex.length,
      companyRelationCount: index.companyIndex.length,
      policies: index.policyIndex
    };
  }

  if (type === "industry") {
    return index.industryIndex.filter((item) => matches(normalized,
      item.industry,
      item.policyTitle,
      item.policyAction,
      item.reason,
      item.relatedNodes,
      item.watchSignals
    ));
  }

  if (type === "company") {
    return index.companyIndex.filter((item) => matches(normalized,
      item.company,
      item.ticker,
      item.policyTitle,
      item.businessExposure,
      item.relatedNodes,
      item.watchSignals
    ));
  }

  if (type === "policy") {
    return index.policyIndex.filter((item) => matches(normalized,
      item.title,
      item.policyKey,
      item.primaryActionType,
      item.judgement,
      item.followUpSignals
    ));
  }

  throw new Error("Query type must be summary, industry, company, or policy.");
}

function matches(query, ...values) {
  if (!query) return true;
  return normalize(values.flat(Infinity).join(" ")).includes(query);
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s《》“”"'（）()，,。.;；:：\-—_]/g, "");
}

function parseArgs(argv) {
  const parsed = { type: "summary", query: "", format: "text", manifest: DEFAULT_MANIFEST };
  const positional = [];
  for (const arg of argv) {
    if (arg === "--json" || arg === "--format=json") parsed.format = "json";
    else if (arg.startsWith("--manifest=")) parsed.manifest = arg.slice("--manifest=".length);
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else positional.push(arg);
  }
  if (positional[0]) parsed.type = positional[0];
  if (positional.length > 1) parsed.query = positional.slice(1).join(" ");
  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  npm run stage9:first-six:query -- summary
  npm run stage9:first-six:query -- industry 电网
  npm run stage9:first-six:query -- company 万华化学
  npm run stage9:first-six:query -- policy 标准
  npm run stage9:first-six:query -- company 科大讯飞 --json

Options:
  --json                 Output machine-readable JSON.
  --manifest=<path>      Override the batch manifest.
`);
}

function printText(type, result) {
  if (type === "summary") {
    console.log(`[stage9:first-six] policies=${result.policyCount} industryRelations=${result.industryRelationCount} companyRelations=${result.companyRelationCount}`);
    for (const item of result.policies) console.log(`- ${item.title} | ${item.primaryActionType} | ${item.reportDepth}`);
    return;
  }

  console.log(`[stage9:first-six] ${type} matches=${result.length}`);
  for (const item of result) {
    if (type === "industry") {
      console.log(`- ${item.industry} <- ${item.policyTitle} | ${item.evidenceLevel} | ${item.policyAction}`);
    } else if (type === "company") {
      console.log(`- ${item.company}${item.ticker ? ` (${item.ticker})` : ""} <- ${item.policyTitle} | ${item.relationship}/${item.policyEvidence}`);
    } else {
      console.log(`- ${item.title} | ${item.primaryActionType} | ${item.analysisDepth}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const batch = await loadFirstSixBatch(process.cwd(), args.manifest);
  const index = buildFirstSixResearchIndex(batch);
  const result = queryFirstSixIndex(index, args.type, args.query);
  if (args.format === "json") console.log(JSON.stringify(result, null, 2));
  else printText(args.type, result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[stage9:first-six] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
