#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const DEFAULT_ORIGIN = "https://agent-ovo.github.io";
const qaUserScript = path.resolve("scripts", "manage-production-qa-user.mjs");
const qaBrowserScript = path.resolve("scripts", "production-authenticated-qa.playwright.js");

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

function quoteCmdArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${String(value).replace(/(["^&|<>%])/g, "^$1")}"`;
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
  return run("cmd.exe", ["/d", "/s", "/c", ["npx", ...args].map(quoteCmdArg).join(" ")], options);
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
  try {
    return JSON.parse(output.trim());
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

const options = parseArgs(process.argv.slice(2));
const origin = options.origin === true ? DEFAULT_ORIGIN : String(options.origin || DEFAULT_ORIGIN);
const outputFile = options.output && options.output !== true ? path.resolve(String(options.output)) : "";
const sessionName = `policy-prod-qa-${Date.now().toString(36)}`;
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

  runPlaywright(sessionName, ["open", "about:blank"], { quiet: true });
  runPlaywright(sessionName, ["state-load", context.storageStatePath], { quiet: true });
  const qaOutput = runNpx([
    "--yes",
    "--package",
    "@playwright/cli",
    "playwright-cli",
    "--raw",
    `-s=${sessionName}`,
    "run-code",
    "--filename",
    qaBrowserScript
  ], { quiet: true });
  qaResult = readJsonOutput(qaOutput, "Authenticated browser QA");

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
}

if (primaryError) {
  console.error(`[production-authenticated-qa] ${primaryError.message}`);
  process.exitCode = 1;
} else {
  const summary = {
    ok: true,
    authenticated: qaResult.authenticated,
    reportCount: qaResult.reportCount,
    fullInvestmentPanels: qaResult.fullInvestmentPanels,
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
