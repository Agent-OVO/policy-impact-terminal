#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const reportPaths = [
  "research-batches/stage9-first-six/reports/1c9d4a56-5f1e-4c16-8b2a-202607101077.json",
  "research-batches/stage9-first-six/reports/95e4c9b2-6fd4-4fb5-b8cb-202606290303.json",
  "research-batches/stage9-first-six/reports/6b23a2d4-8d2a-4f80-9f84-202607070805.json",
  "research-batches/stage9-first-six/reports/8f74d5a1-12e0-4de2-8f6a-202606090269.json",
  "manual-reports/4e45255c-dc48-4526-8ca3-3f313e68780a.json",
  "manual-reports/3abd8068-084e-441f-b96b-7c849ca324f7.json"
];

execFileSync(process.execPath, ["scripts/validate-manual-report.mjs", ...reportPaths], {
  cwd: process.cwd(),
  env: { ...process.env, MANUAL_QUALITY_STRICT: "true" },
  stdio: "inherit"
});

console.log(`[stage9:first-six-validate] ${reportPaths.length} reports passed strict validation`);
