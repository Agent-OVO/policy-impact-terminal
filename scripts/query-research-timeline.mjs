#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadBuiltResearchIndex, queryResearchTimeline } from "./lib/research-index.mjs";

function parseArgs(argv) {
  const args = { filterType: "all", query: "", json: false, indexPath: undefined };
  const positional = [];
  for (const value of argv) {
    if (value === "--json" || value === "--format=json") args.json = true;
    else if (value.startsWith("--index=")) args.indexPath = value.slice("--index=".length);
    else if (value === "--help" || value === "-h") args.help = true;
    else positional.push(value);
  }
  if (positional[0]) args.filterType = positional[0];
  if (positional.length > 1) args.query = positional.slice(1).join(" ");
  return args;
}

function printHelp() {
  console.log([
    "Usage:",
    "  npm run research:timeline -- all",
    "  npm run research:timeline -- industry 电网",
    "  npm run research:timeline -- company 万华化学",
    "  npm run research:timeline -- policy 输配电价 --json",
    "",
    "Filters: all, industry, company, policy, policy-tool, event-type"
  ].join("\n"));
}

function dateLabel(event) {
  if (event.date) return event.date + " [" + event.datePrecision + "]";
  if (event.dateRange) return event.dateRange.start + ".." + event.dateRange.end + " [" + event.datePrecision + "]";
  return "日期未明";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const index = await loadBuiltResearchIndex(process.cwd(), args.indexPath);
  const result = queryResearchTimeline(index, args.filterType, args.query);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log("[research:timeline] matches=" + result.count);
  if (!result.count) console.log("未找到时间线事件。");
  for (const event of result.results) {
    console.log("- " + dateLabel(event) + " | " + event.eventType + " | " + event.description);
    if (event.uncertainty) console.log("  uncertainty: " + event.uncertainty);
  }
  console.log(result.disclaimer);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("[research:timeline] " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
