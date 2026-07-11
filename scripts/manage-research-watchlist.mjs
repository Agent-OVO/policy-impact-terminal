#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadBuiltResearchIndex, normalizeResearchText } from "./lib/research-index.mjs";

function parseArgs(argv) {
  const args = { command: "list", query: "", json: false, indexPath: undefined };
  const positional = [];
  for (const value of argv) {
    if (value === "--json" || value === "--format=json") args.json = true;
    else if (value.startsWith("--index=")) args.indexPath = value.slice("--index=".length);
    else if (value === "--help" || value === "-h") args.help = true;
    else positional.push(value);
  }
  if (positional[0]) args.command = positional[0];
  if (positional.length > 1) args.query = positional.slice(1).join(" ");
  return args;
}

function matches(item, query) {
  if (!query) return true;
  const normalized = normalizeResearchText([
    item.objectType,
    item.objectId,
    item.displayName,
    item.attentionLevel,
    item.status,
    ...(item.reasons ?? [])
  ].join(" "));
  return normalized.includes(normalizeResearchText(query));
}

function printHelp() {
  console.log([
    "Usage:",
    "  npm run research:watchlist -- validate",
    "  npm run research:watchlist -- list",
    "  npm run research:watchlist -- list 等待证据",
    "  npm run research:watchlist -- show 万华化学 --json"
  ].join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const index = await loadBuiltResearchIndex(process.cwd(), args.indexPath);
  if (args.command === "validate") {
    const result = {
      ...index.watchlist.validation,
      capacity: index.watchlist.capacity,
      size: index.watchlist.objects.length,
      remainingCapacity: index.watchlist.capacity - index.watchlist.objects.length
    };
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log("[research:watchlist] valid=" + result.valid + " size=" + result.size +
      "/" + result.capacity + " errors=" + result.errors.length + " warnings=" + result.warnings.length);
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (!["list", "show"].includes(args.command)) throw new Error("Command must be validate, list, or show.");
  const results = index.watchlist.objects.filter((item) => matches(item, args.query));
  const result = {
    query: { command: args.command, input: args.query },
    count: results.length,
    results,
    capacity: index.watchlist.capacity
  };
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log("[research:watchlist] matches=" + results.length + " size=" +
    index.watchlist.objects.length + "/" + index.watchlist.capacity);
  if (!results.length) console.log("未找到观察对象。");
  for (const item of results) {
    console.log("- " + item.displayName + " | " + item.objectType + " | " +
      item.status + " | attention=" + item.attentionLevel + " | next=" + item.nextReviewDate);
    console.log("  reasons: " + item.reasons.join("；"));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("[research:watchlist] " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
