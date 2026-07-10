#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const distDir = path.join(root, "dist");
const assetsDir = path.join(distDir, "assets");

const limits = {
  maxJavaScriptBytes: 300 * 1024,
  totalJavaScriptBytes: 650 * 1024,
  maxCssBytes: 180 * 1024,
  sourceMapCount: 0
};

function formatBytes(value) {
  return `${(value / 1024).toFixed(2)} KiB`;
}

function fail(message) {
  console.error(`[build:budget] fail ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(path.join(distDir, "index.html"))) {
  fail("dist/index.html is missing; run npm run build first");
  process.exit();
}

if (!fs.existsSync(assetsDir)) {
  fail("dist/assets is missing; run npm run build first");
  process.exit();
}

const files = fs.readdirSync(assetsDir).map((name) => {
  const filePath = path.join(assetsDir, name);
  return { name, bytes: fs.statSync(filePath).size };
});
const javaScript = files.filter((file) => file.name.endsWith(".js"));
const css = files.filter((file) => file.name.endsWith(".css"));
const sourceMaps = files.filter((file) => file.name.endsWith(".map"));

if (javaScript.length === 0) fail("no JavaScript chunks were produced");
if (css.length === 0) fail("no CSS assets were produced");

const largestJavaScript = [...javaScript].sort((a, b) => b.bytes - a.bytes)[0];
const totalJavaScriptBytes = javaScript.reduce((sum, file) => sum + file.bytes, 0);
const largestCss = [...css].sort((a, b) => b.bytes - a.bytes)[0];

if (largestJavaScript && largestJavaScript.bytes > limits.maxJavaScriptBytes) {
  fail(
    `largest JavaScript chunk ${largestJavaScript.name} is ${formatBytes(largestJavaScript.bytes)}, ` +
      `above ${formatBytes(limits.maxJavaScriptBytes)}`
  );
}
if (totalJavaScriptBytes > limits.totalJavaScriptBytes) {
  fail(
    `total JavaScript is ${formatBytes(totalJavaScriptBytes)}, ` +
      `above ${formatBytes(limits.totalJavaScriptBytes)}`
  );
}
if (largestCss && largestCss.bytes > limits.maxCssBytes) {
  fail(`largest CSS asset ${largestCss.name} is ${formatBytes(largestCss.bytes)}, above ${formatBytes(limits.maxCssBytes)}`);
}
if (sourceMaps.length > limits.sourceMapCount) {
  fail(`production output contains ${sourceMaps.length} source map file(s)`);
}

console.log(`[build:budget] JavaScript chunks=${javaScript.length}`);
console.log(
  `[build:budget] largest JavaScript=${largestJavaScript?.name ?? "none"} ` +
    `${formatBytes(largestJavaScript?.bytes ?? 0)} / ${formatBytes(limits.maxJavaScriptBytes)}`
);
console.log(
  `[build:budget] total JavaScript=${formatBytes(totalJavaScriptBytes)} / ${formatBytes(limits.totalJavaScriptBytes)}`
);
console.log(
  `[build:budget] largest CSS=${largestCss?.name ?? "none"} ` +
    `${formatBytes(largestCss?.bytes ?? 0)} / ${formatBytes(limits.maxCssBytes)}`
);
console.log(`[build:budget] source maps=${sourceMaps.length}`);

if (!process.exitCode) console.log("[build:budget] all bundle budgets passed");
