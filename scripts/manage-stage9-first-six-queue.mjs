#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_FILE = "research-batches/stage9-first-six/queue-dispositions.json";
const ALLOWED = new Set([
  "immediate_analysis",
  "retain_observation",
  "downgrade_archive",
  "defer_pending_evidence"
]);

export async function loadQueueDisposition(file = DEFAULT_FILE, root = process.cwd()) {
  const data = JSON.parse(await fs.readFile(path.resolve(root, file), "utf8"));
  validateQueueDisposition(data);
  return data;
}

export function validateQueueDisposition(data) {
  if (!data || typeof data !== "object") throw new Error("Queue disposition must be a JSON object.");
  if (!Array.isArray(data.items)) throw new Error("Queue disposition items must be an array.");
  const keys = new Set();
  const counts = Object.fromEntries([...ALLOWED].map((key) => [key, 0]));

  for (const [index, item] of data.items.entries()) {
    if (!item || typeof item !== "object") throw new Error(`items[${index}] must be an object.`);
    if (!item.policyKey || !item.title) throw new Error(`items[${index}] requires policyKey and title.`);
    if (keys.has(item.policyKey)) throw new Error(`Duplicate policyKey: ${item.policyKey}`);
    keys.add(item.policyKey);
    if (!ALLOWED.has(item.disposition)) throw new Error(`Invalid disposition for ${item.policyKey}: ${item.disposition}`);
    if (String(item.manualReason ?? "").trim().length < 20) throw new Error(`manualReason is too short for ${item.policyKey}`);
    if (String(item.nextAction ?? "").trim().length < 8) throw new Error(`nextAction is too short for ${item.policyKey}`);
    counts[item.disposition] += 1;
  }

  const immediateLimit = Number(data.capacity?.immediateAnalysisLimit ?? 3);
  const pendingLimit = Number(data.capacity?.pendingQueueLimit ?? 8);
  if (counts.immediate_analysis > immediateLimit) {
    throw new Error(`Immediate analysis count ${counts.immediate_analysis} exceeds limit ${immediateLimit}.`);
  }
  const activeCount = counts.immediate_analysis + counts.retain_observation + counts.defer_pending_evidence;
  if (activeCount > pendingLimit) throw new Error(`Active queue count ${activeCount} exceeds limit ${pendingLimit}.`);

  for (const disposition of ALLOWED) {
    if (counts[disposition] < 1) throw new Error(`Queue must demonstrate disposition '${disposition}'.`);
  }

  if (data.counts) {
    for (const disposition of ALLOWED) {
      if (Number(data.counts[disposition]) !== counts[disposition]) {
        throw new Error(`Stored count for ${disposition} does not match items.`);
      }
    }
  }
  return { counts, activeCount, itemCount: data.items.length };
}

export function filterQueueDisposition(data, disposition = "all", query = "") {
  const normalized = normalize(query);
  return data.items.filter((item) => {
    if (disposition !== "all" && item.disposition !== disposition) return false;
    if (!normalized) return true;
    return normalize(`${item.title} ${item.policyKey} ${item.manualReason} ${item.nextAction}`).includes(normalized);
  });
}

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s《》“”"'（）()，,。.;；:：\-—_]/g, "");
}

function parseArgs(argv) {
  const parsed = { command: "list", disposition: "all", query: "", format: "text", file: DEFAULT_FILE };
  const positional = [];
  for (const arg of argv) {
    if (arg === "--json") parsed.format = "json";
    else if (arg.startsWith("--file=")) parsed.file = arg.slice("--file=".length);
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else positional.push(arg);
  }
  if (positional[0]) parsed.command = positional[0];
  if (positional[1]) parsed.disposition = positional[1];
  if (positional.length > 2) parsed.query = positional.slice(2).join(" ");
  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  npm run stage9:first-six:queue -- validate
  npm run stage9:first-six:queue -- list all
  npm run stage9:first-six:queue -- list immediate_analysis
  npm run stage9:first-six:queue -- list retain_observation 机器人 --json

This tool is read-only. Edit queue-dispositions.json through normal reviewed file changes.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const data = await loadQueueDisposition(args.file);
  if (args.command === "validate") {
    const result = validateQueueDisposition(data);
    console.log(args.format === "json" ? JSON.stringify(result, null, 2) : `[stage9:queue] valid items=${result.itemCount} active=${result.activeCount}`);
    return;
  }
  if (args.command !== "list") throw new Error("Command must be validate or list.");
  const rows = filterQueueDisposition(data, args.disposition, args.query);
  if (args.format === "json") console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(`[stage9:queue] matches=${rows.length}`);
    for (const item of rows) console.log(`- ${item.disposition} | ${item.title} | ${item.nextAction}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[stage9:queue] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
