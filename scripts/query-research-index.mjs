#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadBuiltResearchIndex, queryResearchIndex } from "./lib/research-index.mjs";

function parseArgs(argv) {
  const args = { type: "summary", query: "", json: false, indexPath: undefined };
  const positional = [];
  for (const value of argv) {
    if (value === "--json" || value === "--format=json") args.json = true;
    else if (value.startsWith("--index=")) args.indexPath = value.slice("--index=".length);
    else if (value === "--help" || value === "-h") args.help = true;
    else positional.push(value);
  }
  if (positional[0]) args.type = positional[0];
  if (positional.length > 1) args.query = positional.slice(1).join(" ");
  return args;
}

function printHelp() {
  console.log([
    "Usage:",
    "  npm run research:query -- summary",
    "  npm run research:query -- company 万华化学",
    "  npm run research:query -- industry 人工智能",
    "  npm run research:query -- policy-tool 价格",
    "  npm run research:query -- relation 科大讯飞",
    "  npm run research:query -- policy 城市更新 --json",
    "",
    "Types: summary, company, industry, policy, policy-tool, evidence, relation"
  ].join("\n"));
}

function printCompany(item) {
  console.log("- " + item.companyName + (item.ticker ? " (" + item.ticker + ")" : "") +
    " | policies=" + item.policyCoverageCount);
  for (const relation of item.relationships) {
    console.log("  * " + relation.policyTitle + " | " + (relation.policyPublishDate ?? "日期未明") +
      " | " + relation.relationship + " | policy=" + (relation.policyEvidenceStrength || "unknown") +
      " business=" + (relation.businessEvidenceStrength || "unknown") +
      (relation.officialMention ? " | 官方点名" : ""));
    if (relation.relatedNodes.length) console.log("    nodes: " + relation.relatedNodes.join(" / "));
    printList("    risks", relation.risks, 5);
    printList("    watch", relation.watchSignals, 6);
  }
}

function printIndustry(item) {
  console.log("- " + item.canonicalName + " | policies=" + item.policyCount +
    " | direct=" + item.directRelationCount + " indirect=" + item.indirectRelationCount +
    " | continuity=" + item.continuity.status);
  console.log("  originals: " + item.originalNames.join(" / "));
  for (const policy of item.policies) {
    console.log("  * " + (policy.publishDate ?? "日期未明") + " | " + policy.title);
  }
  console.log("  verifiedCompanies=" + item.verifiedCompanyKeys.length +
    " pendingCompanies=" + item.pendingCompanyKeys.length);
  printList("  conditions", item.realizationConditions, 12);
  printList("  counter", item.counterEvidence, 8);
}

function printList(label, values, limit) {
  if (!values?.length) return;
  const visible = values.slice(0, limit);
  const remainder = values.length - visible.length;
  console.log(label + ": " + visible.join("；") + (remainder > 0 ? "；… +" + remainder : ""));
}

function printText(type, result) {
  if (type === "summary") {
    console.log("[research:query] " + Object.entries(result.summary).map(([key, value]) => key + "=" + value).join(" "));
    console.log(result.disclaimer);
    return;
  }
  console.log("[research:query] " + type + " matches=" + result.count);
  if (!result.count) {
    console.log("未找到结果。请检查名称、别名或先运行 npm run research:index -- build。");
    return;
  }
  for (const hint of result.normalizationHints ?? []) console.log("规范化提示: " + hint);
  for (const item of result.results) {
    if (type === "company") printCompany(item);
    else if (type === "industry") printIndustry(item);
    else if (type === "policy") {
      console.log("- " + item.title + " | " + (item.publishDate ?? "日期未明") +
        " | " + item.primaryActionType + " | " + item.reportSource + " " + item.reportVersion);
    } else if (type === "policy-tool") {
      console.log("- " + item.toolKey + " | labels=" + item.labels.join("/") + " | policies=" + item.policyCount);
      for (const policy of item.policies) console.log("  * " + (policy.publishDate ?? "日期未明") + " | " + policy.title);
    } else if (type === "evidence") {
      console.log("- " + item.evidenceId + " | " + item.type + " | " + item.source + " " + item.sourceLocation);
    } else {
      console.log("- " + item.companyName + " | " + item.changeType + " | " +
        item.fromLevel + " -> " + item.toLevel + " | " + item.reason);
      if (item.oppositeEvidence?.length) console.log("  counter: " + item.oppositeEvidence.join("；"));
    }
  }
  console.log(result.disclaimer);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const index = await loadBuiltResearchIndex(process.cwd(), args.indexPath);
  const result = queryResearchIndex(index, args.type, args.query);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printText(args.type, result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("[research:query] " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
