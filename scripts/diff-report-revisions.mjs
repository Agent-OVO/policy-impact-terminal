#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { diffJson } from "./lib/report-revision-core.mjs";

const args = parseArgs(process.argv.slice(2));
const before = JSON.parse(await fs.readFile(path.resolve(args.before), "utf8"));
const after = JSON.parse(await fs.readFile(path.resolve(args.after), "utf8"));
const result = diffJson(before, after, { maxChanges: args.maxChanges });

console.log(`[stage7:diff] equal=${result.equal} added=${result.counts.added} removed=${result.counts.removed} changed=${result.counts.changed} total=${result.counts.total} truncated=${result.truncated}`);
console.log(`[stage7:diff] beforeHash=${result.beforeHash}`);
console.log(`[stage7:diff] afterHash=${result.afterHash}`);

if (args.out) {
  const outputPath = path.resolve(args.out);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`[stage7:diff] wrote ${outputPath}`);
} else {
  console.log(JSON.stringify(result.changes, null, 2));
}

if (args.failOnChange && !result.equal) process.exitCode = 2;

function parseArgs(argv) {
  const parsed = {
    before: "",
    after: "",
    out: "",
    maxChanges: 10_000,
    failOnChange: false
  };

  for (const arg of argv) {
    if (arg.startsWith("--before=")) parsed.before = arg.slice("--before=".length);
    else if (arg.startsWith("--after=")) parsed.after = arg.slice("--after=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg.startsWith("--max-changes=")) parsed.maxChanges = Number(arg.slice("--max-changes=".length)) || parsed.maxChanges;
    else if (arg === "--fail-on-change") parsed.failOnChange = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.before || !parsed.after) {
    throw new Error("Both --before=<json> and --after=<json> are required.");
  }
  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  npm run stage7:diff -- --before=<old.json> --after=<new.json>
  npm run stage7:diff -- --before=<old.json> --after=<new.json> --out=artifacts/stage7/revision-diff.json

Options:
  --before=<path>        Previous report or revision payload JSON.
  --after=<path>         New report or revision payload JSON.
  --out=<path>           Optional JSON diff output path.
  --max-changes=<n>      Maximum leaf changes. Default: 10000.
  --fail-on-change       Exit with code 2 when any change exists.
`);
}
