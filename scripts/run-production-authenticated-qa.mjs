#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const DEFAULT_ORIGIN = "https://agent-ovo.github.io";
const qaUserScript = path.resolve("scripts", "manage-production-qa-user.mjs");
const qaBrowserScript = "scripts/production-authenticated-qa.playwright.js";
const governanceRegistryFile = path.resolve("docs", "manual-analysis", "report-governance-registry-v1.0.json");

function readQaExpectations() {
  const registry = JSON.parse(fs.readFileSync(governanceRegistryFile, "utf8"));
  const reports = Array.isArray(registry.reports) ? registry.reports : [];
  const reportIds = reports
    .map((item) => typeof item?.policyId === "string" ? item.policyId.trim() : "")
    .filter(Boolean);
  return {
    reportIds,
    reportCount: reportIds.length,
    fullReportCount: reports.filter((item) => item?.migrationStatus === "full").length
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
    options[key] = value;
  }
  return options;
}

function quoteBashArg(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function findWindowsGitBash() {
  const candidates = [
    process.env.BASH,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Git", "usr", "bin", "bash.exe") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : ""
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function run(command, args, { quiet = false } = {}) {
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  try {
    const output = execFileSync(command, args, options);
    if (!quiet && output.trim()) process.stdout.write(output);
    return output;
  } catch (error) {
    const stdout = error?.stdout?.toString?.().trim();
    const stderr = error?.stderr?.toString?.().trim();
    throw new Error([stderr, stdout].filter(Boolean).join("\n") || `${command} failed.`);
  }
}

function runNpx(args, options) {
  if (process.platform !== "win32") return run("npx", args, options);
  const bash = findWindowsGitBash();
  if (!bash) throw new Error("Git Bash is required to run authenticated production QA on Windows.");
  const command = ["npx", ...args].map(quoteBashArg).join(" ");
  return run(bash, ["-lc", command], options);
}

function runPlaywright(sessionName, args, options) {
  return runNpx([
    "--yes",
    "--package",
    "@playwright/cli",
    "playwright-cli",
    `-s=${sessionName}`,
    ...args
  ], options);
}

function readJsonOutput(output, label) {
  const text = output.replace(/\u001b\[[0-9;]*m/g, "").trim();
  const candidates = [
    text,
    ...text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse()
  ];
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next representation.
    }
  }
  const diagnostic = {
    length: text.length,
    start: text.slice(0, 160),
    end: text.slice(-160)
  };
  throw new Error(`${label} did not return valid JSON: ${JSON.stringify(diagnostic)}`);
}

const options = parseArgs(process.argv.slice(2));
const origin = options.origin === true ? DEFAULT_ORIGIN : String(options.origin || DEFAULT_ORIGIN);
const outputFile = options.output && options.output !== true ? path.resolve(String(options.output)) : "";
const qaExpectations = readQaExpectations();
const qaScriptTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-production-qa-script-"));
const qaRuntimeScript = path.join(qaScriptTempDir, "production-authenticated-qa.runtime.js");
const qaBrowserSource = fs.readFileSync(path.resolve(qaBrowserScript), "utf8")
  .replace("__PRODUCTION_QA_EXPECTED_REPORT_IDS__", JSON.stringify(qaExpectations.reportIds))
  .replace("__PRODUCTION_QA_EXPECTED_REPORT_COUNT__", String(qaExpectations.reportCount))
  .replace("__PRODUCTION_QA_EXPECTED_FULL_REPORT_COUNT__", String(qaExpectations.fullReportCount));
fs.writeFileSync(qaRuntimeScript, qaBrowserSource, "utf8");
const sessionName = `policyprodqa${Date.now().toString(36)}`;
let context = null;
let qaResult = null;
let cleanupResult = null;
let primaryError = null;

try {
  const createOutput = run(process.execPath, [qaUserScript, "create", "--origin", origin], { quiet: true });
  context = readJsonOutput(createOutput, "QA user creation");
  if (!context.ok || !context.contextPath || !context.storageStatePath) {
    throw new Error("QA user creation did not return a usable context.");
  }

  const playwrightStorageStatePath = String(context.storageStatePath).replace(/\\/g, "/");
  runPlaywright(sessionName, ["open", "about:blank"], { quiet: true });
  runPlaywright(sessionName, ["state-load", playwrightStorageStatePath], { quiet: true });
  const qaOutput = runNpx([
    "--yes",
    "--package",
    "@playwright/cli",
    "playwright-cli",
    "--raw",
    `-s=${sessionName}`,
    "run-code",
    "--filename",
    qaRuntimeScript.replace(/\\/g, "/")
  ], { quiet: true });
  qaResult = readJsonOutput(qaOutput, "Authenticated browser QA");
  if (Array.isArray(qaResult.assertionFailures) && qaResult.assertionFailures.length > 0) {
    throw new Error(`Authenticated production QA failed: ${qaResult.assertionFailures.join("; ")}`);
  }

  if (outputFile) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(qaResult, null, 2)}\n`, "utf8");
  }
} catch (error) {
  primaryError = error;
} finally {
  try {
    runPlaywright(sessionName, ["close"], { quiet: true });
  } catch {
    // The browser may never have opened; user cleanup must still continue.
  }

  if (context?.contextPath && fs.existsSync(context.contextPath)) {
    try {
      const cleanupOutput = run(process.execPath, [qaUserScript, "cleanup", "--context", context.contextPath], { quiet: true });
      cleanupResult = readJsonOutput(cleanupOutput, "QA user cleanup");
      if (!cleanupResult.ok) throw new Error("QA user cleanup verification failed.");
    } catch (error) {
      if (!primaryError) primaryError = error;
      else primaryError = new Error(`${primaryError.message}\nCleanup also failed: ${error.message}`);
    }
  }
  fs.rmSync(qaScriptTempDir, { recursive: true, force: true });
}

if (primaryError) {
  console.error(`[production-authenticated-qa] ${primaryError.message}`);
  process.exitCode = 1;
} else {
  const summary = {
    ok: true,
    authenticated: qaResult.authenticated,
    reportCount: qaResult.reportCount,
    expectedReportCount: qaResult.expectedReportCount,
    fullInvestmentPanels: qaResult.fullInvestmentPanels,
    expectedFullReportCount: qaResult.expectedFullReportCount,
    policyNetworkPanels: qaResult.policyNetworkPanels,
    desktopFailures: qaResult.desktopSummary?.failures?.length ?? 0,
    desktopOverflow: qaResult.desktopSummary?.overflow?.length ?? 0,
    desktopRuntimeErrors: qaResult.desktopSummary?.runtimeErrors?.length ?? 0,
    mobileFailures: qaResult.mobileSummary?.failures?.length ?? 0,
    mobileOverflow: qaResult.mobileSummary?.overflow?.length ?? 0,
    mobileRuntimeErrors: qaResult.mobileSummary?.runtimeErrors?.length ?? 0,
    assertionFailures: qaResult.assertionFailures ?? [],
    userCleanup: cleanupResult?.checks ?? {},
    detailOutput: outputFile || undefined,
    completedAt: new Date().toISOString()
  };
  console.log(JSON.stringify(summary, null, 2));
}
