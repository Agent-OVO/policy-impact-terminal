#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const runs = JSON.parse(await fs.readFile(path.resolve(args.input), "utf8"));
const recoveryRuns = args.recoveryInput
  ? JSON.parse(await fs.readFile(path.resolve(args.recoveryInput), "utf8"))
  : [];
const nowMs = Date.parse(args.now ?? new Date().toISOString());
if (!Number.isFinite(nowMs)) throw new Error(`Invalid --now value: ${args.now}`);
const scheduleRuns = (Array.isArray(runs) ? runs : [])
  .filter((item) => item.event === "schedule")
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
const activeScheduleRun = scheduleRuns.find((item) => item.status === "queued" || item.status === "in_progress") ?? null;
const successfulScheduleRuns = scheduleRuns.filter((item) => item.status === "completed" && item.conclusion === "success");
const latest = successfulScheduleRuns[0] ?? null;
const latestRecovery = (Array.isArray(recoveryRuns) ? recoveryRuns : [])
  .filter((item) => item.status === "completed" && item.conclusion === "success")
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
const latestOperational = [latest, latestRecovery]
  .filter(Boolean)
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
const ageMinutes = latestOperational ? (nowMs - Date.parse(latestOperational.createdAt)) / 60_000 : Number.POSITIVE_INFINITY;
const needed = args.force || (!activeScheduleRun && (!latestOperational || ageMinutes > args.thresholdMinutes));
const decision = {
  formatVersion: "hourly-recovery-decision-v1",
  evaluatedAt: new Date(nowMs).toISOString(),
  thresholdMinutes: args.thresholdMinutes,
  latestSuccessfulScheduleRunAt: latest?.createdAt ?? null,
  latestSuccessfulScheduleRunId: latest?.databaseId ?? null,
  latestSuccessfulRecoveryRunAt: latestRecovery?.createdAt ?? null,
  latestSuccessfulRecoveryRunId: latestRecovery?.databaseId ?? null,
  latestOperationalRunAt: latestOperational?.createdAt ?? null,
  latestOperationalRunId: latestOperational?.databaseId ?? null,
  activeScheduleRunAt: activeScheduleRun?.createdAt ?? null,
  activeScheduleRunId: activeScheduleRun?.databaseId ?? null,
  ageMinutes: Number.isFinite(ageMinutes) ? Number(ageMinutes.toFixed(2)) : null,
  force: args.force,
  needed,
  reason: args.force
    ? "forced_by_explicit_dispatch"
    : activeScheduleRun
      ? "primary_schedule_run_active"
      : !latestOperational
        ? "no_successful_operational_run_found"
        : ageMinutes > args.thresholdMinutes
          ? "schedule_gap_exceeds_threshold"
          : "recent_schedule_run_is_healthy"
};
await writeJson(args.out, decision);
if (args.githubOutput) {
  await fs.appendFile(path.resolve(args.githubOutput), `needed=${needed}\nreason=${decision.reason}\n`, "utf8");
}
console.log(`[hourly:recovery] needed=${needed} reason=${decision.reason} ageMinutes=${decision.ageMinutes ?? "unknown"} threshold=${args.thresholdMinutes}`);

function parseArgs(argv) {
  const parsed = {
    input: "artifacts/recovery/hourly-runs.json",
    recoveryInput: null,
    out: "artifacts/recovery/recovery-decision.json",
    thresholdMinutes: 80,
    now: null,
    force: false,
    githubOutput: null
  };
  for (const arg of argv) {
    if (arg.startsWith("--input=")) parsed.input = arg.slice(8);
    else if (arg.startsWith("--recovery-input=")) parsed.recoveryInput = arg.slice(17);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice(6);
    else if (arg.startsWith("--threshold-minutes=")) parsed.thresholdMinutes = positiveInteger(arg.slice(20), 80);
    else if (arg.startsWith("--now=")) parsed.now = arg.slice(6);
    else if (arg === "--force") parsed.force = true;
    else if (arg.startsWith("--github-output=")) parsed.githubOutput = arg.slice(16);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/evaluate-hourly-recovery.mjs --input=<run-list.json> [--recovery-input=<run-list.json>] [--threshold-minutes=80] [--force]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
async function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
