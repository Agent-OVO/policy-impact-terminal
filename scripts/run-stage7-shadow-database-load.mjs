#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const forwardedArgs = process.argv.slice(2);
const applyRequested = forwardedArgs.includes("--apply");
const PG_VERSION = "8.16.3";
let tempDir = null;

try {
  let pgModulePath = process.env.PG_MODULE_PATH?.trim();
  if (applyRequested && !pgModulePath) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-pg-"));
    await installTemporaryPackage(tempDir, `pg@${PG_VERSION}`);
    const packageJsonPath = path.join(tempDir, "node_modules", "pg", "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    if (packageJson.version !== PG_VERSION) {
      throw new Error(`Expected pg ${PG_VERSION}, installed ${packageJson.version}.`);
    }
    pgModulePath = path.join(tempDir, "node_modules", "pg", "lib", "index.js");
  }

  const env = {
    ...process.env,
    ...(pgModulePath ? { PG_MODULE_PATH: pgModulePath } : {})
  };
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.resolve("scripts/apply-stage7-shadow-database.mjs"),
    ...forwardedArgs
  ], {
    cwd: process.cwd(),
    env,
    timeout: applyRequested ? 300_000 : 60_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} finally {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
}

async function installTemporaryPackage(prefix, packageSpec) {
  console.log(`[stage7:db-load] installing temporary ${packageSpec}`);
  const npmArgs = [
    "install", "--prefix", prefix, "--no-save", "--package-lock=false",
    "--ignore-scripts", "--audit=false", "--fund=false", packageSpec
  ];
  if (process.platform === "win32") {
    const command = ["npm", ...npmArgs].map(quoteWindowsArgument).join(" ");
    await execFileAsync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], {
      cwd: process.cwd(), timeout: 180_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true
    });
  } else {
    await execFileAsync("npm", npmArgs, {
      cwd: process.cwd(), timeout: 180_000, maxBuffer: 8 * 1024 * 1024
    });
  }
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
