#!/usr/bin/env node

import fs from "node:fs/promises";

const files = process.argv.slice(2);

if (files.length === 0) {
  fail("Usage: npm run manual:validate -- <manual-report.json> [...more.json]");
}

let failed = false;

for (const file of files) {
  try {
    await validateFile(file);
    console.log(`[manual:validate] ok ${file}`);
  } catch (error) {
    failed = true;
    console.error(`[manual:validate] fail ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) process.exit(1);

async function validateFile(file) {
  const raw = await fs.readFile(file, "utf8");
  assertNoEncodingArtifacts(raw);

  let report;
  try {
    report = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(report)) {
    throw new Error("top-level value must be a JSON object");
  }

  const errors = [];
  const warnings = [];
  const brief = recordField(report, "brief") ?? recordField(report, "policyBrief") ?? recordField(report, "policy_brief");
  const policy = recordField(report, "policy") ?? report;
  const summary = recordField(report, "summary");
  const coverage = recordField(report, "analysisCoverage") ?? recordField(report, "analysis_coverage");
  const actions = arrayField(report, "actions");
  const clauses = arrayField(report, "clauses");
  const chainNodes = arrayField(report, "chainNodes", "chain_nodes");
  const chainEdges = arrayField(report, "chainEdges", "chain_edges");
  const companies = arrayField(report, "companies");
  const evidence = arrayField(report, "evidence");
  const backgroundCards = arrayField(report, "backgroundCards", "background_cards");
  const judgement = stringField(brief, "judgement") ?? stringField(brief, "judgment") ?? stringField(brief, "oneLine") ?? "";
  const companyNoMatchReason =
    stringField(coverage, "companyImpactConclusion") ??
    stringField(coverage, "companyImpactReasoning") ??
    stringField(coverage, "companyNoMatchReason") ??
    stringField(report, "companyImpactConclusion") ??
    "";

  if (judgement.trim().length < 40) {
    errors.push("brief.judgement must be a synthesized conclusion of at least 40 chars");
  }
  if (!hasCjk(judgement)) {
    errors.push("brief.judgement must contain readable Chinese analysis text");
  }
  if (looksLikePolicyTitle(judgement, policy, summary)) {
    errors.push("brief.judgement appears to be a copied policy title rather than analysis");
  }
  if (actions.length < 2) errors.push("actions must include at least 2 analyzed policy actions");
  if (clauses.length < 2) errors.push("clauses must include at least 2 interpreted clauses");
  if (chainNodes.length < 1) errors.push("chainNodes must include at least 1 impact node");
  if (evidence.length < 2) errors.push("evidence must include at least 2 evidence items");
  if (backgroundCards.length < 1) errors.push("backgroundCards must include at least 1 factual background item");
  if (companies.length < 1 && companyNoMatchReason.trim().length < 30) {
    errors.push("companies must include representative entities, or analysisCoverage must explain why no company mapping is applicable");
  }

  requireTextItems(errors, actions, "actions", ["title", "body", "description"], ["title"]);
  requireTextItems(errors, clauses, "clauses", ["title", "excerpt", "body", "summary"], ["id"]);
  requireTextItems(errors, chainNodes, "chainNodes", ["title", "description", "subtitle"], ["id"]);
  requireTextItems(errors, evidence, "evidence", ["excerpt", "body", "summary"], ["id", "source"]);
  requireTextItems(errors, backgroundCards, "backgroundCards", ["title", "body", "description"], ["title"]);
  if (companies.length > 0) {
    requireTextItems(errors, companies, "companies", ["name", "reason", "description"], ["id", "name"]);
  }

  validateReferences(errors, warnings, { clauses, chainNodes, chainEdges, companies, evidence });

  const sourceUrl = stringField(policy, "sourceUrl") ?? stringField(policy, "source_url") ?? stringField(report, "sourceUrl");
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
    warnings.push("policy.sourceUrl is missing or not an absolute HTTP URL");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  for (const warning of warnings) {
    console.warn(`[manual:validate] warn ${warning}`);
  }
}

function assertNoEncodingArtifacts(text) {
  if (text.includes("\uFFFD")) {
    throw new Error("contains Unicode replacement characters");
  }

  const latinMojibake = (text.match(/[\u00c0-\u00ff]/g) ?? []).length;
  const cjkMojibakeTokens = [
    "\u9286",
    "\u9225",
    "\u951b",
    "\u95ab",
    "\u93c8",
    "\u93c0",
    "\u9428",
    "\u9359",
    "\u9365",
    "\u9435",
    "\u7035",
    "\u59af"
  ];
  const cjkMojibake = cjkMojibakeTokens.reduce((count, token) => count + countToken(text, token), 0);

  if (latinMojibake > 5 || cjkMojibake > 6) {
    throw new Error(`contains likely mojibake artifacts latin=${latinMojibake} cjk=${cjkMojibake}`);
  }
}

function validateReferences(errors, warnings, { clauses, chainNodes, chainEdges, companies, evidence }) {
  const clauseIds = idSet(clauses);
  const nodeIds = idSet(chainNodes);
  const companyIds = idSet(companies);
  const evidenceIds = idSet(evidence);

  for (const [index, edge] of chainEdges.entries()) {
    const from = stringField(edge, "from") ?? stringField(edge, "from_node_id");
    const to = stringField(edge, "to") ?? stringField(edge, "to_node_id");
    if (!from || !to) {
      errors.push(`chainEdges[${index}] must include from and to`);
      continue;
    }
    if (!nodeIds.has(from)) errors.push(`chainEdges[${index}].from references unknown node '${from}'`);
    if (!nodeIds.has(to)) errors.push(`chainEdges[${index}].to references unknown node '${to}'`);
  }

  for (const [index, node] of chainNodes.entries()) {
    checkRefs(errors, warnings, `chainNodes[${index}].clauseIds`, stringArray(node, "clauseIds", "clause_ids", "clause_refs", "clauses"), clauseIds);
    checkRefs(errors, warnings, `chainNodes[${index}].companyIds`, stringArray(node, "companyIds", "company_ids", "company_refs", "companies"), companyIds, { warnIfEmptySet: true });
    checkRefs(errors, warnings, `chainNodes[${index}].evidenceIds`, stringArray(node, "evidenceIds", "evidence_ids", "evidence_refs"), evidenceIds);
  }

  for (const [index, company] of companies.entries()) {
    checkRefs(errors, warnings, `companies[${index}].nodeIds`, stringArray(company, "nodeIds", "node_ids", "nodes"), nodeIds);
    checkRefs(errors, warnings, `companies[${index}].clauseIds`, stringArray(company, "clauseIds", "clause_ids", "clauses"), clauseIds);
    checkRefs(errors, warnings, `companies[${index}].evidenceIds`, stringArray(company, "evidenceIds", "evidence_ids", "evidenceRefs", "evidence_refs"), evidenceIds);
  }

  for (const [index, item] of evidence.entries()) {
    const links = recordField(item, "links");
    checkRefs(errors, warnings, `evidence[${index}].clauseIds`, stringArray(item, "clauseIds", "clause_ids").concat(stringArray(links, "clauseIds", "clause_ids")), clauseIds);
    checkRefs(errors, warnings, `evidence[${index}].nodeIds`, stringArray(item, "nodeIds", "node_ids").concat(stringArray(links, "nodeIds", "node_ids")), nodeIds);
    checkRefs(errors, warnings, `evidence[${index}].companyIds`, stringArray(item, "companyIds", "company_ids").concat(stringArray(links, "companyIds", "company_ids")), companyIds, { warnIfEmptySet: true });
  }
}

function checkRefs(errors, warnings, label, refs, knownIds, options = {}) {
  if (refs.length === 0) return;
  if (knownIds.size === 0 && options.warnIfEmptySet) {
    warnings.push(`${label} has refs but no target collection exists`);
    return;
  }
  for (const ref of refs) {
    if (!knownIds.has(ref)) errors.push(`${label} references unknown id '${ref}'`);
  }
}

function requireTextItems(errors, items, label, textKeys, requiredKeys = []) {
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) {
      errors.push(`${label}[${index}] must be an object`);
      continue;
    }
    for (const key of requiredKeys) {
      if (!stringField(item, key)) errors.push(`${label}[${index}].${key} is required`);
    }
    const hasText = textKeys.some((key) => {
      const value = stringField(item, key);
      return value && value.length >= 2;
    });
    if (!hasText) errors.push(`${label}[${index}] lacks readable analysis text`);
  }
}

function idSet(items) {
  return new Set(items.map((item) => stringField(item, "id")).filter(Boolean));
}

function arrayField(record, ...keys) {
  if (!isRecord(record)) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function recordField(record, key) {
  if (!isRecord(record)) return null;
  return isRecord(record[key]) ? record[key] : null;
}

function stringField(record, key) {
  if (!isRecord(record)) return "";
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function stringArray(record, ...keys) {
  if (!isRecord(record)) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.map((item) => String(item ?? "").trim()).filter(Boolean);
    }
  }
  return [];
}

function looksLikePolicyTitle(judgement, policy, summary) {
  const title = stringField(policy, "title") || stringField(summary, "title");
  if (!title) return false;
  const compactJudgement = compact(judgement);
  const compactTitle = compact(title);
  return compactJudgement === compactTitle || compactJudgement.startsWith(compactTitle);
}

function hasCjk(value) {
  return /[\u4e00-\u9fff]/.test(value);
}

function countToken(text, token) {
  let count = 0;
  let index = text.indexOf(token);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(token, index + token.length);
  }
  return count;
}

function compact(value) {
  return String(value ?? "").replace(/\s+/g, "").replace(/[《》"'“”‘’.,，。:：;；]/g, "");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message) {
  console.error(`[manual:validate] ${message}`);
  process.exit(1);
}
