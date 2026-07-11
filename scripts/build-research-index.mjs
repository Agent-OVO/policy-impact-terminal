#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_RESEARCH_INDEX_PATH,
  buildResearchIndexFromDisk,
  loadBuiltResearchIndex,
  validateBuiltResearchIndex,
  writeResearchIndex
} from "./lib/research-index.mjs";

function parseArgs(argv) {
  const args = { command: "build", output: DEFAULT_RESEARCH_INDEX_PATH, json: false };
  for (const value of argv) {
    if (value === "build" || value === "validate" || value === "check") args.command = value;
    else if (value === "--json") args.json = true;
    else if (value.startsWith("--output=")) args.output = value.slice("--output=".length);
    else if (value === "--help" || value === "-h") args.help = true;
    else throw new Error("Unknown argument: " + value);
  }
  return args;
}

function printHelp() {
  console.log([
    "Usage:",
    "  npm run research:index -- build",
    "  npm run research:index -- validate",
    "  npm run research:index -- check",
    "",
    "Options:",
    "  --output=<path>   Override research-index/research-index.json.",
    "  --json            Print machine-readable result."
  ].join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (args.command === "build") {
    const { index, outputPath } = await writeResearchIndex(process.cwd(), args.output);
    const result = {
      status: "built",
      outputPath,
      sourceFingerprint: index.sourceFingerprint,
      summary: index.summary
    };
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log("[research:index] built " + outputPath + " " + JSON.stringify(index.summary));
    return;
  }
  const built = await loadBuiltResearchIndex(process.cwd(), args.output);
  if (args.command === "validate") {
    const validation = validateBuiltResearchIndex(built);
    if (args.json) console.log(JSON.stringify(validation, null, 2));
    else console.log("[research:index] valid=" + validation.valid + " errors=" + validation.errors.length);
    if (!validation.valid) process.exitCode = 1;
    return;
  }
  const current = await buildResearchIndexFromDisk(process.cwd());
  const result = {
    current:
      built.sourceFingerprint === current.sourceFingerprint &&
      JSON.stringify(built) === JSON.stringify(current),
    builtFingerprint: built.sourceFingerprint,
    sourceFingerprint: current.sourceFingerprint
  };
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log("[research:index] current=" + result.current);
  if (!result.current) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("[research:index] " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
