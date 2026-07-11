#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const sharedSecuritySteps = [
  "Test deterministic policy triage",
  "Check limited crawl contract",
  "Execute revision lifecycle migrations in temporary PostgreSQL WASM",
  "Check invite-only authentication boundary",
  "Check workflow contracts",
  "Check generated workflow consistency",
  "Check production mutation guards",
  "Check zero-cost backup guards",
  "Check zero-cost backup cryptography",
  "Check production source export guards",
  "Type-check Edge Functions",
  "Test Edge Function shared boundaries"
];

const contracts = [
  {
    file: ".github/workflows/manual-quality.yml",
    requiredSteps: [
      "Install dependencies",
      "Audit dependencies",
      "Validate Stage 9 first-six research batch",
      "Validate Stage 10 cross-policy observation kernel",
      "Validate all manual reports",
      "Validate revision and projection core",
      ...sharedSecuritySteps,
      "Build frontend",
      "Check bundle budgets"
    ]
  },
  {
    file: ".github/workflows/deploy-pages.yml",
    requiredSteps: [
      "Install dependencies",
      "Audit dependencies",
      "Validate all manual reports",
      ...sharedSecuritySteps,
      "Build static frontend",
      "Check bundle budgets",
      "Deploy to GitHub Pages"
    ]
  },
  {
    file: ".github/workflows/apply-manual-analysis.yml",
    requiredSteps: [
      "Install dependencies",
      "Validate report file path",
      "Validate manual report payload",
      ...sharedSecuritySteps,
      "Apply manual analysis"
    ]
  }
];

for (const contract of contracts) {
  const text = await fs.readFile(contract.file, "utf8");
  const lines = text.split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => line === "jobs:");
  assert.ok(jobsIndex > 0, `${contract.file} must contain top-level jobs:`);

  const prefix = lines.slice(0, jobsIndex);
  assert.equal(
    prefix.some((line) => /^\s+- name:/.test(line)),
    false,
    `${contract.file} must not contain workflow steps inside on:/paths:`
  );
  assert.equal(
    prefix.some((line) => /^\s+run:/.test(line)),
    false,
    `${contract.file} must not contain run commands before jobs:`
  );

  const suffix = lines.slice(jobsIndex).join("\n");
  for (const stepName of contract.requiredSteps) {
    const marker = `- name: ${stepName}`;
    assert.ok(suffix.includes(marker), `${contract.file} is missing step '${stepName}'`);
  }

  const pathSection = extractPathSection(lines);
  for (const line of pathSection) {
    assert.match(
      line,
      /^\s{6}- "[^"]+"$/,
      `${contract.file} contains an invalid pull_request.paths entry: ${line}`
    );
  }
}

console.log(`[workflow:test] ${contracts.length} workflow contracts passed`);

function extractPathSection(lines) {
  const pathsIndex = lines.findIndex((line) => /^\s{4}paths:$/.test(line));
  if (pathsIndex < 0) return [];

  const rows = [];
  for (const line of lines.slice(pathsIndex + 1)) {
    if (!line.trim()) continue;
    const indentation = line.match(/^\s*/)?.[0].length ?? 0;
    if (indentation <= 4) break;
    rows.push(line);
  }
  return rows;
}
