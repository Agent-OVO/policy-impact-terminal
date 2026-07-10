#!/usr/bin/env node

import fs from "node:fs/promises";

const files = process.argv.slice(2);
const QUALITY_STRICT = process.env.MANUAL_QUALITY_STRICT === "true" || process.env.CI_MANUAL_QUALITY_STRICT === "true";

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
  const policyIndustryMap = arrayField(report, "policyIndustryMap", "policy_industry_map");
  const industryChain = arrayField(report, "industryChain", "industry_chain");
  const companyMap = arrayField(report, "companyMap", "company_map");
  const policyNetwork = arrayField(report, "policyNetwork", "policy_network");
  const investmentDirection = recordField(report, "investmentDirection") ?? recordField(report, "investment_direction");
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
  if (companyMap.length > 0) {
    const summaryCompanyCount = numberField(summary, "companyCount", "company_count");
    const coverageCompanyCount = numberField(coverage, "companyCount", "company_count");
    if (summaryCompanyCount !== companyMap.length) {
      errors.push(`summary.companyCount must equal authoritative companyMap length ${companyMap.length}`);
    }
    if (coverageCompanyCount !== companyMap.length) {
      errors.push(`analysisCoverage.companyCount must equal authoritative companyMap length ${companyMap.length}`);
    }
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
  validateQualityDiscipline(errors, warnings, {
    report,
    policy,
    summary,
    actions,
    companies,
    policyIndustryMap,
    industryChain,
    companyMap,
    policyNetwork,
    investmentDirection,
    evidence,
    clauses,
    chainNodes,
    backgroundCards
  });

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

function validateQualityDiscipline(errors, warnings, {
  report,
  policy,
  summary,
  actions,
  companies,
  policyIndustryMap,
  industryChain,
  companyMap,
  policyNetwork,
  investmentDirection,
  evidence,
  clauses,
  chainNodes,
  backgroundCards
}) {
  const qualityIssues = QUALITY_STRICT ? errors : warnings;
  const qualityPrefix = QUALITY_STRICT ? "quality error" : "quality warning";
  const title = stringField(policy, "title") || stringField(summary, "title") || "untitled policy";
  const policyType = stringField(report, "policyType") || stringField(policy, "policyType") || inferPolicyType(title);
  const isPlanningPolicy = /规划|行动方案/.test(title) || /规划|planning/i.test(policyType);

  if (isPlanningPolicy && companies.length > 8) {
    warnings.push(`quality warning: planning policy has ${companies.length} company mappings; consider reducing or grouping them`);
  }
  if (isPlanningPolicy && clauses.length < 5 && title.length > 0) {
    warnings.push(`quality warning: planning policy has only ${clauses.length} clauses; clause granularity may be too coarse`);
  }
  if (backgroundCards.length < 3) {
    warnings.push(`quality warning: backgroundCards has fewer than 3 items`);
  }

  validateMethodologyDiscipline(errors, warnings, {
    report,
    actions,
    chainNodes,
    companies,
    policyIndustryMap,
    industryChain,
    companyMap,
    policyNetwork,
    investmentDirection,
    evidence,
    clauses
  });

  const compareInsight = recordField(report, "compareInsights") ?? recordField(report, "compare_insights");
  if (compareInsight) {
    const comparableCount = numberField(compareInsight, "comparableCount", "comparable_count") ?? 0;
    const compareText = JSON.stringify(compareInsight);
    const hasTransparentNoComparisonNote = /未做横向对比|未启用横向对比|仅基于当前政策|尚未调用/.test(compareText);
    const hasComparisonClaim = /相比|较此前|延续上一轮|强于|弱于|上一轮政策|历史政策/.test(compareText);
    if (comparableCount === 0 && !hasTransparentNoComparisonNote) {
      qualityIssues.push(`${qualityPrefix}: compareInsights.comparableCount is 0 but no transparent no-comparison note is provided`);
    }
    if (comparableCount === 0 && hasComparisonClaim && !hasTransparentNoComparisonNote) {
      qualityIssues.push(`${qualityPrefix}: compareInsights makes comparison-like claims while comparableCount is 0`);
    }
  }

  const companyScoresAreDefaulted = companies.length > 0 && companies.every((company) => {
    const confidence = numberField(company, "confidence");
    const policyRelevance = numberField(company, "policyRelevance", "policy_relevance");
    const evidenceCertainty = numberField(company, "evidenceCertainty", "evidence_certainty");
    return confidence !== null && policyRelevance === confidence && evidenceCertainty === confidence;
  });
  if (companyScoresAreDefaulted) {
    qualityIssues.push(`${qualityPrefix}: all companies use identical confidence/policyRelevance/evidenceCertainty; split the two matrix dimensions`);
  }

  for (const [index, company] of companies.entries()) {
    validateCompanyQuality(qualityIssues, qualityPrefix, company, index);
  }

  for (const [index, item] of evidence.entries()) {
    const excerpt = stringField(item, "excerpt") || stringField(item, "body") || stringField(item, "summary");
    const interpretation = stringField(item, "interpretation") || stringField(item, "analysis") || stringField(item, "commentary");
    if (looksLikeInterpretiveExcerpt(excerpt) && interpretation.length < 10) {
      qualityIssues.push(`${qualityPrefix}: evidence[${index}].excerpt looks interpretive; move analysis to interpretation and keep excerpt close to source text`);
    }
  }
}

function validateMethodologyDiscipline(errors, warnings, {
  report,
  actions,
  chainNodes,
  companies,
  policyIndustryMap,
  industryChain,
  companyMap,
  policyNetwork,
  investmentDirection,
  evidence
}) {
  const methodologyVersion = stringField(report, "methodologyVersion") || stringField(report, "methodology_version");
  const isV101 = /policy-decomposition-methodology-v1\.0\.1|v1\.0\.1/i.test(methodologyVersion);
  const isIndustryCompanyV1 = /policy-industry-company-methodology-v1\.0/i.test(methodologyVersion);
  const requiresEvidenceDiscipline = isV101 || isIndustryCompanyV1;
  const issues = QUALITY_STRICT && requiresEvidenceDiscipline ? errors : warnings;
  const prefix = requiresEvidenceDiscipline && QUALITY_STRICT ? "methodology error" : "methodology warning";

  const requiredTopFields = [
    ["documentShellType", "document_shell_type"],
    ["substantivePolicyType", "substantive_policy_type"],
    ["primaryActionType", "primary_action_type"],
    ["policySignalStrength", "policy_signal_strength"],
    ["implementationCertainty", "implementation_certainty"],
    ["analysisDepth", "analysis_depth"],
    ["analysisDepthReason", "analysis_depth_reason"]
  ];
  for (const keys of requiredTopFields) {
    if (!stringField(report, keys[0]) && !stringField(report, keys[1])) {
      issues.push(`${prefix}: report must include ${keys[0]} for the declared methodology`);
    }
  }

  const signalStrength = normalizeToken(stringField(report, "policySignalStrength") || stringField(report, "policy_signal_strength"));
  const implementationCertainty = normalizeToken(stringField(report, "implementationCertainty") || stringField(report, "implementation_certainty"));
  if (signalStrength && !["high", "medium", "low"].includes(signalStrength)) {
    issues.push(`${prefix}: policySignalStrength must be high, medium, or low`);
  }
  if (implementationCertainty && !["high", "medium", "low"].includes(implementationCertainty)) {
    issues.push(`${prefix}: implementationCertainty must be high, medium, or low`);
  }
  const analysisDepth = normalizeToken(stringField(report, "analysisDepth") || stringField(report, "analysis_depth")).toUpperCase();
  if (analysisDepth && !["L0", "L1", "L2", "L3", "L4", "L5"].includes(analysisDepth)) {
    issues.push(`${prefix}: analysisDepth must be L0-L5`);
  }

  if (requiresEvidenceDiscipline) {
    for (const [index, action] of actions.entries()) {
      if (!stringField(action, "actionType") && !stringField(action, "action_type")) issues.push(`${prefix}: actions[${index}] must include actionType`);
      if (!stringField(action, "actionEvidenceLevel") && !stringField(action, "action_evidence_level")) issues.push(`${prefix}: actions[${index}] must include actionEvidenceLevel`);
    }
    for (const [index, node] of chainNodes.entries()) {
      if (!stringField(node, "industryNodeEvidenceLevel") && !stringField(node, "industry_node_evidence_level")) issues.push(`${prefix}: chainNodes[${index}] must include industryNodeEvidenceLevel`);
    }
    for (const [index, item] of evidence.entries()) {
      if (!stringField(item, "evidenceObject") && !stringField(item, "evidence_object")) issues.push(`${prefix}: evidence[${index}] should include evidenceObject`);
    }
  }

  if (isV101) {
    for (const [index, company] of companies.entries()) {
      if (!stringField(company, "companyMappingEvidenceLevel") && !stringField(company, "company_mapping_evidence_level")) issues.push(`${prefix}: companies[${index}] must include companyMappingEvidenceLevel`);
      if (!stringField(company, "mappingLevel") && !stringField(company, "mapping_level")) issues.push(`${prefix}: companies[${index}] must include mappingLevel`);
    }
  }

  if (!isIndustryCompanyV1) return;

  if (policyIndustryMap.length < 1) issues.push(`${prefix}: policyIndustryMap must include at least 1 industry relationship`);
  if (industryChain.length < 1) issues.push(`${prefix}: industryChain must include at least 1 chain`);
  if (!investmentDirection) issues.push(`${prefix}: investmentDirection is required`);
  if (companies.length > 0 && companyMap.length < 1) issues.push(`${prefix}: companyMap is required when companies are present`);

  const nodeIds = idSet(chainNodes);
  const companyIds = idSet(companies);

  for (const [index, item] of policyIndustryMap.entries()) {
    if (!stringField(item, "industry")) issues.push(`${prefix}: policyIndustryMap[${index}].industry is required`);
    if (!stringField(item, "reason")) issues.push(`${prefix}: policyIndustryMap[${index}].reason is required`);
    checkRefs(issues, warnings, `policyIndustryMap[${index}].relatedNodeIds`, stringArray(item, "relatedNodeIds", "related_node_ids"), nodeIds);
  }

  for (const [chainIndex, chain] of industryChain.entries()) {
    const nodes = arrayField(chain, "nodes");
    if (!stringField(chain, "chainName") && !stringField(chain, "chain_name")) issues.push(`${prefix}: industryChain[${chainIndex}].chainName is required`);
    if (nodes.length < 1) issues.push(`${prefix}: industryChain[${chainIndex}].nodes must include at least 1 node`);
    for (const [nodeIndex, node] of nodes.entries()) {
      const nodeId = stringField(node, "id");
      if (!nodeId || !nodeIds.has(nodeId)) issues.push(`${prefix}: industryChain[${chainIndex}].nodes[${nodeIndex}].id must match an existing chainNodes id`);
      if (!stringField(node, "policySensitivity") && !stringField(node, "policy_sensitivity")) issues.push(`${prefix}: industryChain[${chainIndex}].nodes[${nodeIndex}].policySensitivity is required`);
      if (!stringField(node, "description") && !stringField(node, "body")) issues.push(`${prefix}: industryChain[${chainIndex}].nodes[${nodeIndex}].description is required`);
      const relationCompanyIds = stringArray(node, "companyIds", "company_ids");
      checkRefs(issues, warnings, `industryChain[${chainIndex}].nodes[${nodeIndex}].companyIds`, relationCompanyIds, companyIds, { warnIfEmptySet: true });

      const sourceNode = chainNodes.find((candidate) => stringField(candidate, "id") === nodeId);
      const relationPosition = stringField(node, "position") || stringField(node, "section");
      const sourcePosition = stringField(sourceNode, "section");
      if (relationPosition && sourcePosition && normalizeToken(relationPosition) !== normalizeToken(sourcePosition)) {
        issues.push(`${prefix}: industryChain[${chainIndex}].nodes[${nodeIndex}].position conflicts with chainNodes section for '${nodeId}'`);
      }
      const relationEvidence = stringField(node, "evidenceLevel") || stringField(node, "evidence_level");
      const sourceEvidence = stringField(sourceNode, "industryNodeEvidenceLevel") || stringField(sourceNode, "industry_node_evidence_level") || stringField(sourceNode, "evidenceLevel") || stringField(sourceNode, "evidence_level");
      if (relationEvidence && sourceEvidence && normalizeQualityEvidenceLevel(relationEvidence) !== normalizeQualityEvidenceLevel(sourceEvidence)) {
        issues.push(`${prefix}: industryChain[${chainIndex}].nodes[${nodeIndex}].evidenceLevel conflicts with chainNodes evidence for '${nodeId}'`);
      }
      const sourceCompanyIds = stringArray(sourceNode, "companyIds", "company_ids");
      if (relationCompanyIds.length > 0 && sourceCompanyIds.length > 0 && !sameStringSet(relationCompanyIds, sourceCompanyIds)) {
        issues.push(`${prefix}: industryChain[${chainIndex}].nodes[${nodeIndex}].companyIds conflicts with chainNodes companyIds for '${nodeId}'`);
      }
    }
  }

  const regulatoryPolicyText = [
    stringField(report, "substantivePolicyType") || stringField(report, "substantive_policy_type"),
    stringField(report, "primaryActionType") || stringField(report, "primary_action_type")
  ].filter(Boolean).join(" ");
  const requiresRegulatoryRoles = /监管|监察|执法|处罚|标准约束/.test(regulatoryPolicyText);

  for (const [index, item] of companyMap.entries()) {
    const companyId = stringField(item, "companyId") || stringField(item, "company_id");
    const chainNodeId = stringField(item, "chainNodeId") || stringField(item, "chain_node_id");
    const relationship = stringField(item, "relationship") || stringField(item, "mappingLevel") || stringField(item, "mapping_level");
    const policyEvidence = stringField(item, "policyEvidence") || stringField(item, "policy_evidence");
    const regulatoryRole = normalizeToken(stringField(item, "regulatoryRole") || stringField(item, "regulatory_role"));
    if (!companyId || !companyIds.has(companyId)) issues.push(`${prefix}: companyMap[${index}].companyId must match an existing companies id`);
    if (!chainNodeId || !nodeIds.has(chainNodeId)) issues.push(`${prefix}: companyMap[${index}].chainNodeId must match an existing chainNodes id`);
    if (!relationship) issues.push(`${prefix}: companyMap[${index}].relationship is required`);
    if (!policyEvidence) issues.push(`${prefix}: companyMap[${index}].policyEvidence is required`);
    if (!stringField(item, "businessExposure") && !stringField(item, "business_exposure")) issues.push(`${prefix}: companyMap[${index}].businessExposure is required`);
    if (!stringField(item, "investmentUse") && !stringField(item, "investment_use")) issues.push(`${prefix}: companyMap[${index}].investmentUse is required`);
    if (requiresRegulatoryRoles && !regulatoryRole) {
      issues.push(`${prefix}: companyMap[${index}].regulatoryRole is required for regulatory policies`);
    }
    if (regulatoryRole && !["constraint_exposed", "compliance_provider", "mixed", "not_applicable"].includes(regulatoryRole)) {
      issues.push(`${prefix}: companyMap[${index}].regulatoryRole is invalid`);
    }
    const regulatoryRisks = stringArray(item, "keyRisks", "key_risks", "risks");
    const regulatorySignals = stringArray(item, "watchSignals", "watch_signals");
    if (["constraint_exposed", "mixed"].includes(regulatoryRole) && regulatoryRisks.length < 1) {
      issues.push(`${prefix}: companyMap[${index}] ${regulatoryRole} role requires keyRisks`);
    }
    if (["compliance_provider", "mixed"].includes(regulatoryRole) && regulatorySignals.length < 1) {
      issues.push(`${prefix}: companyMap[${index}] ${regulatoryRole} role requires watchSignals`);
    }

    const sourceCompany = companies.find((company) => stringField(company, "id") === companyId);
    const relationCompanyName = stringField(item, "company") || stringField(item, "name") || stringField(item, "companyName") || stringField(item, "company_name");
    const sourceCompanyName = stringField(sourceCompany, "name");
    if (relationCompanyName && sourceCompanyName && relationCompanyName.trim() !== sourceCompanyName.trim()) {
      issues.push(`${prefix}: companyMap[${index}].company conflicts with companies name for '${companyId}'`);
    }
    const relationTicker = stringField(item, "ticker") || stringField(item, "symbol");
    const sourceTicker = stringField(sourceCompany, "ticker");
    if (relationTicker && sourceTicker && relationTicker.trim() !== sourceTicker.trim()) {
      issues.push(`${prefix}: companyMap[${index}].ticker conflicts with companies ticker for '${companyId}'`);
    }
    const legacyMappingLevel = stringField(sourceCompany, "mappingLevel") || stringField(sourceCompany, "mapping_level");
    const legacyPolicyEvidence = stringField(sourceCompany, "companyMappingEvidenceLevel") || stringField(sourceCompany, "company_mapping_evidence_level");
    if (legacyMappingLevel && relationship && normalizeToken(legacyMappingLevel) !== normalizeToken(relationship)) {
      issues.push(`${prefix}: companyMap[${index}].relationship conflicts with companies mappingLevel for '${companyId}'`);
    }
    if (legacyPolicyEvidence && policyEvidence && normalizeQualityEvidenceLevel(legacyPolicyEvidence) !== normalizeQualityEvidenceLevel(policyEvidence)) {
      issues.push(`${prefix}: companyMap[${index}].policyEvidence conflicts with companies companyMappingEvidenceLevel for '${companyId}'`);
    }
  }

  for (const [index, item] of policyNetwork.entries()) {
    if (!stringField(item, "relatedPolicy") && !stringField(item, "related_policy")) issues.push(`${prefix}: policyNetwork[${index}].relatedPolicy is required`);
    if (!stringField(item, "meaning")) issues.push(`${prefix}: policyNetwork[${index}].meaning is required`);

    const evidenceLevel = normalizeQualityEvidenceLevel(stringField(item, "evidenceLevel") || stringField(item, "evidence_level"));
    const sourceDate = stringField(item, "sourceDate") || stringField(item, "source_date");
    const sourceUrl = stringField(item, "sourceUrl") || stringField(item, "source_url") || stringField(item, "url");
    if (evidenceLevel === "strong" && !sourceDate) issues.push(`${prefix}: policyNetwork[${index}].sourceDate is required for strong relationships`);
    if (evidenceLevel === "strong" && !sourceUrl) issues.push(`${prefix}: policyNetwork[${index}].sourceUrl is required for strong relationships`);
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) issues.push(`${prefix}: policyNetwork[${index}].sourceUrl must be an absolute HTTP URL`);
  }

  if (investmentDirection) {
    if (!stringField(investmentDirection, "primaryDirection") && !stringField(investmentDirection, "primary_direction")) issues.push(`${prefix}: investmentDirection.primaryDirection is required`);
    if (!stringField(investmentDirection, "summary")) issues.push(`${prefix}: investmentDirection.summary is required`);
  }

  const investmentText = JSON.stringify({ companyMap, investmentDirection });
  if (containsMisleadingInvestmentLanguage(investmentText)) {
    issues.push(`${prefix}: investment observation fields contain prohibited trading or certainty language`);
  }
}

function validateCompanyQuality(qualityIssues, qualityPrefix, company, index) {
  const label = stringField(company, "name") || `companies[${index}]`;
  const evidenceLevel = normalizeQualityEvidenceLevel(
    stringField(company, "evidenceLevel") || stringField(company, "evidence_level") || stringField(company, "evidence")
  );
  const confidence = numberField(company, "confidence");
  const policyRelevance = numberField(company, "policyRelevance", "policy_relevance");
  const evidenceCertainty = numberField(company, "evidenceCertainty", "evidence_certainty");
  const relation = normalizeToken(stringField(company, "relation"));
  const officialMention = booleanField(company, "officialMention", "official_mention");
  const mappingLevel = normalizeToken(stringField(company, "mappingLevel") || stringField(company, "mapping_level"));
  const uncertainty = stringField(company, "uncertainty") || stringField(company, "riskNote") || stringField(company, "risk_note");
  const combinedText = [
    stringField(company, "reason"),
    stringField(company, "description"),
    stringField(company, "opportunity"),
    stringField(company, "uncertainty"),
    stringField(company, "riskNote"),
    stringArray(company, "riskFactors", "risk_factors").join("。")
  ].filter(Boolean).join("。 ");

  if (confidence !== null) {
    const maxConfidence = maxConfidenceForEvidence(evidenceLevel, mappingLevel);
    if (confidence > maxConfidence) {
      qualityIssues.push(`${qualityPrefix}: ${label} confidence=${confidence} exceeds max ${maxConfidence} for evidenceLevel=${evidenceLevel || "unknown"}`);
    }
  }

  if (policyRelevance === null || evidenceCertainty === null) {
    qualityIssues.push(`${qualityPrefix}: ${label} must explicitly include policyRelevance and evidenceCertainty`);
  } else {
    const maxEvidenceCertainty = maxEvidenceCertaintyForEvidence(evidenceLevel, mappingLevel);
    if (evidenceCertainty > maxEvidenceCertainty) {
      qualityIssues.push(`${qualityPrefix}: ${label} evidenceCertainty=${evidenceCertainty} exceeds max ${maxEvidenceCertainty} for evidenceLevel=${evidenceLevel || "unknown"}`);
    }
  }

  const isBeneficiary = ["beneficiary", "benefit", "positive", "潜在受益", "利好"].includes(relation);
  if (isBeneficiary && evidenceLevel !== "strong" && uncertainty.length < 20) {
    qualityIssues.push(`${qualityPrefix}: ${label} is beneficiary with non-strong evidence and needs a concrete riskNote/uncertainty`);
  }

  if (!officialMention && containsMisleadingInvestmentLanguage(combinedText)) {
    qualityIssues.push(`${qualityPrefix}: ${label} contains misleading investment-like wording without officialMention=true`);
  }

  if (["thematic_only", "watch_only"].includes(mappingLevel) && confidence !== null && confidence > 60) {
    qualityIssues.push(`${qualityPrefix}: ${label} mappingLevel=${mappingLevel} should not have confidence above 60`);
  }
}

function maxConfidenceForEvidence(evidenceLevel, mappingLevel) {
  if (mappingLevel === "policy_named") return 100;
  if (mappingLevel === "thematic_only" || mappingLevel === "watch_only") return 60;
  if (evidenceLevel === "strong") return 100;
  if (evidenceLevel === "indirect") return 74;
  if (evidenceLevel === "pending") return 64;
  return 70;
}

function maxEvidenceCertaintyForEvidence(evidenceLevel, mappingLevel) {
  if (mappingLevel === "policy_named") return 95;
  if (mappingLevel === "thematic_only" || mappingLevel === "watch_only") return 45;
  if (evidenceLevel === "strong") return 90;
  if (evidenceLevel === "indirect") return 60;
  if (evidenceLevel === "pending") return 45;
  return 60;
}

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeQualityEvidenceLevel(value) {
  const token = normalizeToken(value);
  if (["strong", "high", "强证据"].includes(token)) return "strong";
  if (["indirect", "medium", "间接证据"].includes(token)) return "indirect";
  if (["pending", "low", "unknown", "待验证"].includes(token)) return "pending";
  return "pending";
}

function looksLikeInterpretiveExcerpt(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return /^(规划|政策|文件|通知|方案|该条|本政策|本规划|本文件)(强调|要求|提出|明确|对应|说明|显示|将|需要|有助于)/.test(text);
}

function containsMisleadingInvestmentLanguage(text) {
  const terms = ["买入", "目标价", "确定受益", "必然受益", "强烈利好", "直接利好", "推荐买入", "收益承诺"];
  for (const term of terms) {
    let start = String(text).indexOf(term);
    while (start !== -1) {
      const prefix = String(text).slice(Math.max(0, start - 16), start);
      if (!/(不应|不宜|不代表|并非|不是|不能|未形成|没有|无)/.test(prefix)) return true;
      start = String(text).indexOf(term, start + term.length);
    }
  }
  return false;
}

function inferPolicyType(title) {
  if (/规划/.test(title)) return "规划";
  if (/实施意见/.test(title)) return "实施意见";
  if (/通知/.test(title)) return "通知";
  if (/公告/.test(title)) return "公告";
  if (/批复/.test(title)) return "批复";
  if (/条例/.test(title)) return "条例";
  return "未标注";
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

function sameStringSet(left, right) {
  const normalize = (items) => [...new Set(items.map((item) => String(item).trim()).filter(Boolean))].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
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

function numberField(record, ...keys) {
  if (!isRecord(record)) return null;
  for (const key of keys) {
    const value = record[key];
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function booleanField(record, ...keys) {
  if (!isRecord(record)) return false;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const token = value.trim().toLowerCase();
      if (["true", "1", "yes", "y"].includes(token)) return true;
      if (["false", "0", "no", "n"].includes(token)) return false;
    }
  }
  return false;
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
