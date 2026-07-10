#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PGLITE_VERSION = "0.5.4";
const packageSpec = `@electric-sql/pglite@${PGLITE_VERSION}`;
const providedModule = process.env.PGLITE_MODULE_PATH?.trim();
const forwardedArgs = process.argv.slice(2);
let tempDir = null;

try {
  let modulePath = providedModule;
  if (!modulePath) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-pglite-"));
    console.log(`[stage7:migration-test] installing temporary ${packageSpec}`);
    const npmArgs = [
      "install",
      "--prefix",
      tempDir,
      "--no-save",
      "--package-lock=false",
      "--ignore-scripts",
      "--audit=false",
      "--fund=false",
      packageSpec
    ];
    if (process.platform === "win32") {
      const command = ["npm", ...npmArgs].map(quoteWindowsArgument).join(" ");
      await execFileAsync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], {
        cwd: process.cwd(),
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      });
    } else {
      await execFileAsync("npm", npmArgs, {
        cwd: process.cwd(),
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024
      });
    }
    const packageJsonPath = path.join(tempDir, "node_modules", "@electric-sql", "pglite", "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    if (packageJson.version !== PGLITE_VERSION) {
      throw new Error(`Expected PGlite ${PGLITE_VERSION}, installed ${packageJson.version}.`);
    }
    modulePath = path.join(tempDir, "node_modules", "@electric-sql", "pglite", "dist", "index.js");
  }

  await execFileAsync(process.execPath, [
    path.resolve("scripts/test-stage7-migration-pglite.mjs"),
    `--pglite-module=${path.resolve(modulePath)}`,
    ...forwardedArgs
  ], {
    cwd: process.cwd(),
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  }).then(({ stdout, stderr }) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  });
} finally {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}
