#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { auditHourlyCollectionRuns } from "./lib/hourly-policy-operations.mjs";

const args = parseArgs(process.argv.slice(2));
const inputPaths = await collectJsonPaths(args.input);
if (inputPaths.length === 0) {
  throw new Error(`No JSON collection artifacts found under ${path.resolve(args.input)}`);
}

const runs = [];
for (const file of inputPaths) {
  const payload = JSON.parse(await fs.readFile(file, "utf8"));
  runs.push({ ...payload, __artifactName: path.relative(process.cwd(), file).replaceAll("\\", "/") });
}

const audit = auditHourlyCollectionRuns(runs, {
  expectedRuns: args.expectedRuns,
  expectedFrequencyMinutes: 60,
  maxGapMinutes: args.maxGapMinutes,
  requireClean: args.requireClean
});

await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
await fs.writeFile(path.resolve(args.out), `${JSON.stringify(audit, null, 2)}\n`, "utf8");

console.log(`[policy:hourly-audit] valid=${audit.valid} runs=${audit.summary.runCount}/${audit.target.expectedRuns} hardErrors=${audit.summary.hardErrorCount} warnings=${audit.summary.warningCount}`);
console.log(`[policy:hourly-audit] candidates=${audit.summary.distinctCandidatesObserved} automaticSelections=${audit.summary.automaticAnalysisSelections} maxGap=${audit.summary.maxObservedGapMinutes}m`);
console.log(`[policy:hourly-audit] wrote ${path.resolve(args.out)}`);

if (args.requireClean && !audit.valid) {
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {
    input: "artifacts/hourly-policy-runs",
    out: "artifacts/hourly-policy-acceptance.json",
    expectedRuns: 24,
    maxGapMinutes: 120,
    requireClean: false
  };
  for (const arg of argv) {
    if (arg.startsWith("--input=")) parsed.input = arg.slice("--input=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg.startsWith("--expected-runs=")) parsed.expectedRuns = parsePositiveInteger(arg.slice("--expected-runs=".length), parsed.expectedRuns);
    else if (arg.startsWith("--max-gap-minutes=")) parsed.maxGapMinutes = parsePositiveInteger(arg.slice("--max-gap-minutes=".length), parsed.maxGapMinutes);
    else if (arg === "--require-clean") parsed.requireClean = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/audit-hourly-policy-collection.mjs [options]\n\nOptions:\n  --input=<file-or-directory>\n  --out=<audit-json>\n  --expected-runs=<n>       Use 24 for one day or 168 for seven days.\n  --max-gap-minutes=<n>     Default 120.\n  --require-clean           Exit non-zero on hard errors or operational warnings.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function collectJsonPaths(input) {
  const absolute = path.resolve(input);
  const stat = await fs.stat(absolute).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return absolute.endsWith(".json") ? [absolute] : [];
  if (!stat.isDirectory()) return [];

  const result = [];
  const queue = [absolute];
  while (queue.length) {
    const directory = queue.shift();
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(current);
      else if (entry.isFile() && entry.name.endsWith(".json")) result.push(current);
    }
  }
  return result.sort();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
