#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const workflowDir = path.resolve(".github/workflows");
const files = (await fs.readdir(workflowDir)).filter((name) => /\.ya?ml$/.test(name)).sort();
assert.ok(files.length > 0, "at least one workflow is required");

for (const file of files) {
  const text = await fs.readFile(path.join(workflowDir, file), "utf8");
  assert.match(text, /^permissions:\s*$/m, `${file} must declare top-level permissions`);
  assert.doesNotMatch(text, /pull_request_target\s*:/, `${file} must not use pull_request_target`);
  for (const match of text.matchAll(/uses:\s*([^\s#]+)/g)) {
    const action = match[1];
    if (action.startsWith("./")) continue;
    assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/i, `${file} action must be pinned to a full commit SHA: ${action}`);
  }
  if (/\bnpm ci\b/.test(text)) {
    assert.doesNotMatch(text, /run:\s*npm ci\s*$/m, `${file} npm ci must disable lifecycle scripts`);
    assert.match(text, /npm ci --ignore-scripts/, `${file} must use npm ci --ignore-scripts`);
  }
  if (/\|\s*tee\b/.test(text)) {
    assert.match(text, /set -euo pipefail/, `${file} must not let tee mask upstream command failures`);
  }
}

const manualEvidenceWorkflow = await fs.readFile(path.join(workflowDir, "get-manual-policy.yml"), "utf8");
assert.match(manualEvidenceWorkflow, /npm run manual:evidence/);
assert.match(manualEvidenceWorkflow, /attachmentEvidenceIncomplete/);
assert.match(manualEvidenceWorkflow, /attachmentManualReviewRequired/);
assert.match(manualEvidenceWorkflow, /attachment_review_completed/);
assert.match(manualEvidenceWorkflow, /attachment-review-confirmation\.json/);
assert.match(manualEvidenceWorkflow, /manifestSha256/);
assert.match(manualEvidenceWorkflow, /manual:policies -- wait/);
assert.match(manualEvidenceWorkflow, /--closeOpenJob=true/);
assert.match(manualEvidenceWorkflow, /if:\s*always\(\)/);
assert.match(manualEvidenceWorkflow, /artifacts\/manual-analysis\/\*\*/);
assert.match(manualEvidenceWorkflow, /retention-days:\s*30/);

const dispositionWorkflow = await fs.readFile(path.join(workflowDir, "set-manual-policy-disposition.yml"), "utf8");
assert.match(dispositionWorkflow, /close_open_job/);
assert.match(dispositionWorkflow, /--closeOpenJob=true/);
assert.match(dispositionWorkflow, /set -euo pipefail/);
assert.match(dispositionWorkflow, /node scripts\/manual-policy-analysis\.mjs/);
assert.doesNotMatch(dispositionWorkflow, /npm run manual:policies[\s\S]*?\|\s*tee/);

const operationsSummaryWorkflow = await fs.readFile(path.join(workflowDir, "production-operations-summary.yml"), "utf8");
assert.match(operationsSummaryWorkflow, /cron:\s*"35 0 \* \* \*"/);
assert.match(operationsSummaryWorkflow, /node scripts\/build-production-operations-summary\.mjs/);
assert.match(operationsSummaryWorkflow, /manual-policy-analysis\.mjs list --limit=100/);

const codeowners = await fs.readFile(".github/CODEOWNERS", "utf8");
for (const protectedPath of ["/.github/workflows/", "/supabase/functions/", "/supabase/migrations/"]) {
  assert.ok(codeowners.includes(protectedPath), `CODEOWNERS must protect ${protectedPath}`);
}
console.log(`[security:workflow-test] ${files.length} workflows use explicit permissions, pinned actions, and lifecycle-script-safe installs`);
