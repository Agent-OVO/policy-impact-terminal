#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildShadowPackage,
  buildSourceDocument,
  diffJson,
  hashJson,
  projectReport,
  REPORT_SCHEMA_VERSION,
  PROJECTION_VERSION
} from "./lib/report-revision-core.mjs";
import {
  assertApprovedOfficialSourceUrl,
  extractOfficialPolicyPage
} from "./lib/official-policy-source.mjs";

const root = process.cwd();
const registry = JSON.parse(
  await fs.readFile(path.join(root, "docs/manual-analysis/report-governance-registry-v1.0.json"), "utf8")
);
const reportFiles = (await fs.readdir(path.join(root, "manual-reports")))
  .filter((file) => file.endsWith(".json"))
  .sort();
const reports = await Promise.all(
  reportFiles.map(async (file) => JSON.parse(await fs.readFile(path.join(root, "manual-reports", file), "utf8")))
);

assert.equal(reports.length, registry.reports.length, "manual reports must match governance registry");
assert.deepEqual(
  new Set(reports.map(policyId)),
  new Set(registry.reports.map((item) => item.policyId)),
  "manual report policy IDs must match governance registry"
);

const shadow = buildShadowPackage(reports, {
  generatedAt: "2026-07-10T00:00:00.000Z"
});
assert.equal(shadow.reportSchemaVersion, REPORT_SCHEMA_VERSION);
assert.equal(shadow.projectionVersion, PROJECTION_VERSION);
assert.equal(shadow.counts.reports, registry.reports.length);
assert.equal(shadow.counts.missingSourceDocuments, reports.length);
assert.equal(shadow.counts.verifiedSourceDocuments, 0);
assert.equal(shadow.counts.candidateSourceDocuments, 0);
assert.equal(shadow.sourceCandidateReady, false);
assert.equal(shadow.deploymentReady, false, "repository-only shadow must wait for production source export");

const sourceFixtureText = Array.from({ length: 10 }, (_, index) =>
  `第${index + 1}条 政策正文内容用于验证官方原文候选、生产交叉核对状态和稳定哈希，不代表真实政策。`
).join("\n\n");
const candidateShadow = buildShadowPackage([reports[0]], {
  generatedAt: "2026-07-10T00:00:00.000Z",
  sourceDocuments: [{
    policyId: policyId(reports[0]),
    fullText: sourceFixtureText,
    metadata: { verificationStatus: "official_url_pending_production_crosscheck" }
  }]
});
assert.equal(candidateShadow.sourceCandidateReady, true);
assert.equal(candidateShadow.deploymentReady, false);
assert.equal(candidateShadow.counts.candidateSourceDocuments, 1);

const verifiedShadow = buildShadowPackage([reports[0]], {
  generatedAt: "2026-07-10T00:00:00.000Z",
  sourceDocuments: [{
    policyId: policyId(reports[0]),
    fullText: sourceFixtureText,
    metadata: { verificationStatus: "official_source_verified" }
  }]
});
assert.equal(verifiedShadow.sourceCandidateReady, true);
assert.equal(verifiedShadow.deploymentReady, true);
assert.equal(verifiedShadow.counts.verifiedSourceDocuments, 1);

const expectedCompanyRelations = reports.reduce((total, report) => {
  const companyMap = array(report.companyMap ?? report.company_map);
  return total + (companyMap.length > 0 ? companyMap.length : array(report.companies).length);
}, 0);
const expectedEvidence = reports.reduce((total, report) => total + array(report.evidence).length, 0);
assert.equal(shadow.counts.companyRelations, expectedCompanyRelations);
assert.equal(shadow.counts.evidenceRefs, expectedEvidence);

for (const report of reports) {
  const projectionA = projectReport(report);
  const projectionB = projectReport(JSON.parse(JSON.stringify(report)));
  assert.equal(projectionA.projectionHash, projectionB.projectionHash, `${policyId(report)} projection hash must be deterministic`);
  assert.equal(hashJson(report), hashJson(JSON.parse(JSON.stringify(report))), `${policyId(report)} payload hash must survive JSON round-trip`);
  assert.equal(projectionA.counts.industryNodes, array(report.chainNodes ?? report.chain_nodes).length);
  assert.equal(projectionA.counts.evidenceRefs, array(report.evidence).length);
}

const sampleText = Array.from({ length: 8 }, (_, index) => `第${index + 1}部分 政策原文段落。该段用于验证规范化、段落拆分和哈希稳定性，不代表生产政策内容。`).join("\n\n");
const sourceA = buildSourceDocument({
  policyId: "00000000-0000-0000-0000-000000000001",
  sourceUrl: "https://example.invalid/policy",
  fullText: sampleText
});
const sourceB = buildSourceDocument({
  policyId: sourceA.policyId,
  sourceUrl: sourceA.sourceUrl,
  fullText: sampleText.replace(/\n/g, "\r\n")
});
assert.equal(sourceA.sourceDocumentHash, sourceB.sourceDocumentHash, "line-ending changes must not change source hash");
assert.equal(sourceA.segments.length, 8);
assert.equal(new Set(sourceA.segments.map((item) => item.segmentHash)).size, 8);
assert.ok(sourceA.segments.every((item) => Number.isInteger(item.sourceLocator.charStart)));
assert.ok(sourceA.segments.every((item) => item.sourceLocator.charEnd > item.sourceLocator.charStart));

const longSource = buildSourceDocument({
  policyId: "00000000-0000-0000-0000-000000000002",
  fullText: `第一章 总则\n\n${"政策实施内容。".repeat(300)}`
});
assert.ok(longSource.segments.length > 2, "long source blocks must be split for incremental reuse");
assert.equal(longSource.segments[0].headingLevel, 1);
assert.deepEqual(longSource.segments[1].headingPath, ["第一章 总则"]);
assert.ok(longSource.segments.every((item) => item.text.length <= 1600));

const officialFixtureBody = "政策正文内容。".repeat(90);
const officialFixtures = [
  {
    url: "https://www.gov.cn/zhengce/content/202601/content_1.htm",
    html: `<html><head><title>国务院政策</title></head><body><div id="UCAP-CONTENT"><p>${officialFixtureBody}</p></div></body></html>`,
    sourceKey: "gov_zhengce_latest",
    selector: "#UCAP-CONTENT"
  },
  {
    url: "https://www.ndrc.gov.cn/xxgk/zcfb/tz/202601/t1.html",
    html: `<html><body><div class="article_con"><p>${officialFixtureBody}</p></div></body></html>`,
    sourceKey: "ndrc_policy_documents",
    selector: ".article_con"
  },
  {
    url: "https://www.miit.gov.cn/zwgk/zcwj/wjfb/tz/art/2026/art_1.html",
    html: `<html><body><div class="ccontent"><p>${officialFixtureBody}</p><a href="/files/a.pdf">附件下载</a></div></body></html>`,
    sourceKey: "miit_policy_library",
    selector: ".ccontent"
  },
  {
    url: "https://www.nda.gov.cn/sjj/zwgk/zcfb/0101/1_pc.html",
    html: `<html><body><div class="detail"><div class="article"><p>${officialFixtureBody}</p></div></div></body></html>`,
    sourceKey: "nda_policy_release",
    selector: ".detail .article"
  }
];
for (const fixture of officialFixtures) {
  assert.equal(assertApprovedOfficialSourceUrl(fixture.url), fixture.url);
  const parsed = extractOfficialPolicyPage(fixture.html, fixture.url, { expectedTitle: "政策" });
  assert.equal(parsed.sourceKey, fixture.sourceKey);
  assert.equal(parsed.selectedSelector, fixture.selector);
  assert.ok(parsed.fullText.length >= 280);
  assert.equal(parsed.diagnostics.fallbackBodyUsed, false);
}
assert.throws(
  () => assertApprovedOfficialSourceUrl("http://127.0.0.1/internal"),
  /outside the approved HTTPS boundary/
);
assert.throws(
  () => assertApprovedOfficialSourceUrl("https://example.com/policy"),
  /outside the approved HTTPS boundary/
);
assert.equal(
  extractOfficialPolicyPage(officialFixtures[2].html, officialFixtures[2].url).attachments.length,
  1,
  "official parser must retain attachment metadata"
);

const equalDiff = diffJson({ b: 2, a: 1 }, { a: 1, b: 2 });
assert.equal(equalDiff.equal, true, "object key order must not create revision changes");
const changedDiff = diffJson(
  { summary: { title: "旧标题" }, companies: [{ id: "c1", relation: "pending" }] },
  { summary: { title: "新标题" }, companies: [{ id: "c1", relation: "direct" }], added: true }
);
assert.deepEqual(changedDiff.counts, { added: 1, removed: 0, changed: 2, total: 3 });
assert.deepEqual(changedDiff.changes.map((item) => item.path), ["/added", "/companies/0/relation", "/summary/title"]);

const migrationPath = path.join(root, "supabase/migrations/20260710010000_stage7_revision_projection_core.sql");
const migration = await fs.readFile(migrationPath, "utf8");
const requiredSqlObjects = [
  "policy_source_documents",
  "policy_source_segments",
  "report_revisions",
  "report_projection_runs",
  "report_policy_actions",
  "report_industry_nodes",
  "report_industry_edges",
  "report_company_relations",
  "report_policy_network_relations",
  "report_evidence_refs",
  "report_signals",
  "company_evidence_cards",
  "report_company_evidence_refs",
  "model_usage_ledger",
  "system_config_versions",
  "can_read_report_revision",
  "is_report_revision_source_current",
  "get_current_report_revision",
  "get_report_revision",
  "list_report_revisions"
];
for (const objectName of requiredSqlObjects) {
  assert.match(migration, new RegExp(`\\b${objectName}\\b`), `migration must define ${objectName}`);
}
assert.doesNotMatch(migration, /metadata\s*\.\s*reportPayload/i, "stage 7 migration must not create a new metadata report write path");
assert.match(migration, /current_published_revision_id/);
assert.match(migration, /current_draft_revision_id/);
assert.match(migration, /current_source_document_id/);
assert.match(migration, /projection_hash/);
assert.match(migration, /content_hash/);
assert.match(migration, /source_document_hash/);
assert.match(migration, /successful matching projection run/);
assert.match(migration, /isSourceCurrent/);
assert.doesNotMatch(migration, /current published revision must match the current source document hash/);
assert.match(migration, /protect_published_revision_delete/);
assert.match(migration, /protect_model_usage_ledger_fields/);
assert.match(migration, /validate_projection_run_lifecycle/);
assert.match(migration, /published report revision lifecycle fields are immutable/);
assert.match(migration, /validate_system_config_lifecycle/);
assert.match(migration, /validate_company_evidence_card_lifecycle/);
assert.match(migration, /protect_immutable_history_delete/);
assert.match(migration, /report_revisions_read_published_history/);
assert.match(migration, /r\.status in \('published', 'superseded'\)/);
assert.doesNotMatch(migration, /grant\s+(?:select\s*,\s*)?insert/i, "browser authenticated role must not receive direct Stage 7 writes");
assert.doesNotMatch(migration, /grant select on public\.report_revisions to authenticated/i, "full revision payloads must use security-definer RPCs");
assert.match(migration, /grant select on public\.report_company_relations to authenticated/i);
assert.match(migration, /revoke all on public\.model_usage_ledger from public, anon, authenticated/i);
assertSqlLexicallyBalanced(migration);

const accountDeletionMigration = await fs.readFile(
  path.join(root, "supabase/migrations/20260710023000_stage8_account_deletion_workflow.sql"),
  "utf8"
);
const stage8DatabaseTypes = await fs.readFile(path.join(root, "supabase/functions/_shared/database.stage8.types.ts"), "utf8");
const accountGovernanceFunction = await fs.readFile(path.join(root, "supabase/functions/account-governance/index.ts"), "utf8");
assert.match(accountDeletionMigration, /\bdeletion_error_message\s+text\s+default\s+null/i);
assert.match(stage8DatabaseTypes, /\bdeletion_error_message\?:\s*string\s*\|\s*null/);
assert.match(accountGovernanceFunction, /\bdeletion_error_message:\s*errorMessage/);
assert.doesNotMatch(stage8DatabaseTypes, /\berror_message\?:/);
assert.doesNotMatch(accountGovernanceFunction, /\berror_message:\s*errorMessage/);

const pointerState = {
  current: "revision-a",
  statuses: new Map([
    ["revision-a", "published"],
    ["revision-b", "approved"]
  ])
};
publish(pointerState, "revision-b");
assert.equal(pointerState.current, "revision-b");
assert.equal(pointerState.statuses.get("revision-a"), "superseded");
rollback(pointerState, "revision-a");
assert.equal(pointerState.current, "revision-a");
assert.equal(pointerState.statuses.get("revision-b"), "superseded");
assert.equal(pointerState.statuses.get("revision-a"), "published");

console.log(`[stage7:test] reports=${shadow.counts.reports} actions=${shadow.counts.policyActions} nodes=${shadow.counts.industryNodes} edges=${shadow.counts.industryEdges}`);
console.log(`[stage7:test] companyRelations=${shadow.counts.companyRelations} policyNetwork=${shadow.counts.policyNetworkRelations} evidence=${shadow.counts.evidenceRefs} signals=${shadow.counts.signals}`);
console.log(`[stage7:test] repositoryBaselineMissingSources=${shadow.counts.missingSourceDocuments}`);
console.log("[stage7:test] all revision, projection, source hash, migration contract, and pointer rollback checks passed");

function policyId(report) {
  return String(report.policyId ?? report.policy_id ?? report.id ?? report.summary?.id ?? "");
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function publish(state, targetRevisionId) {
  const targetStatus = state.statuses.get(targetRevisionId);
  assert.ok(["approved", "superseded"].includes(targetStatus), "target revision must be approved or superseded");
  if (state.current) state.statuses.set(state.current, "superseded");
  state.statuses.set(targetRevisionId, "published");
  state.current = targetRevisionId;
}

function rollback(state, targetRevisionId) {
  assert.equal(state.statuses.get(targetRevisionId), "superseded", "rollback target must be a historical published revision");
  publish(state, targetRevisionId);
}

function assertSqlLexicallyBalanced(sql) {
  let parentheses = 0;
  let state = "normal";
  let dollarTag = "";

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1] ?? "";

    if (state === "line-comment") {
      if (char === "\n") state = "normal";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "normal";
        index += 1;
      }
      continue;
    }
    if (state === "single-quote") {
      if (char === "'" && next === "'") {
        index += 1;
      } else if (char === "'") {
        state = "normal";
      }
      continue;
    }
    if (state === "double-quote") {
      if (char === '"' && next === '"') {
        index += 1;
      } else if (char === '"') {
        state = "normal";
      }
      continue;
    }
    if (state === "dollar-quote") {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        state = "normal";
        dollarTag = "";
      }
      continue;
    }

    if (char === "-" && next === "-") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (char === "'") {
      state = "single-quote";
      continue;
    }
    if (char === '"') {
      state = "double-quote";
      continue;
    }
    if (char === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        state = "dollar-quote";
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (char === "(") parentheses += 1;
    if (char === ")") parentheses -= 1;
    assert.ok(parentheses >= 0, `SQL has an unmatched closing parenthesis near offset ${index}`);
  }

  assert.equal(state, "normal", `SQL ended inside ${state}`);
  assert.equal(parentheses, 0, "SQL parentheses must be balanced outside quoted content");
}
