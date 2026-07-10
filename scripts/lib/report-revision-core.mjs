import crypto from "node:crypto";

export const REPORT_SCHEMA_VERSION = "report-schema-v1.1";
export const PROJECTION_VERSION = "policy-projection-v1";
export const SOURCE_PARSER_VERSION = "source-segmenter-v1";
const MAX_SOURCE_SEGMENT_LENGTH = 1_600;

export function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort(compareCodePoints)
      .map((key) => [key, canonicalizeJson(value[key])])
  );
}

export function stableStringify(value) {
  return JSON.stringify(canonicalizeJson(value));
}

export function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function hashJson(value) {
  return sha256Text(stableStringify(value));
}

export function diffJson(before, after, options = {}) {
  const maxChanges = Number.isFinite(Number(options.maxChanges))
    ? Math.max(1, Math.trunc(Number(options.maxChanges)))
    : 10_000;
  const changes = [];
  const counts = { added: 0, removed: 0, changed: 0 };
  let truncated = false;

  visit(before, after, "");

  return {
    beforeHash: hashJson(before),
    afterHash: hashJson(after),
    equal: counts.added + counts.removed + counts.changed === 0,
    counts: {
      ...counts,
      total: counts.added + counts.removed + counts.changed
    },
    truncated,
    changes
  };

  function visit(left, right, pointer) {
    if (truncated || Object.is(left, right)) return;

    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) {
        record("changed", pointer, left, right);
        return;
      }
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        const nextPointer = `${pointer}/${index}`;
        if (index >= left.length) visitMissing("added", right[index], nextPointer);
        else if (index >= right.length) visitMissing("removed", left[index], nextPointer);
        else visit(left[index], right[index], nextPointer);
        if (truncated) return;
      }
      return;
    }

    if (isRecord(left) || isRecord(right)) {
      if (!isRecord(left) || !isRecord(right)) {
        record("changed", pointer, left, right);
        return;
      }
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(compareCodePoints);
      for (const key of keys) {
        const nextPointer = `${pointer}/${escapeJsonPointer(key)}`;
        if (!(key in left)) visitMissing("added", right[key], nextPointer);
        else if (!(key in right)) visitMissing("removed", left[key], nextPointer);
        else visit(left[key], right[key], nextPointer);
        if (truncated) return;
      }
      return;
    }

    record("changed", pointer, left, right);
  }

  function visitMissing(kind, value, pointer) {
    if (Array.isArray(value)) {
      if (value.length === 0) record(kind, pointer, kind === "removed" ? [] : undefined, kind === "added" ? [] : undefined);
      for (let index = 0; index < value.length; index += 1) {
        visitMissing(kind, value[index], `${pointer}/${index}`);
        if (truncated) return;
      }
      return;
    }
    if (isRecord(value)) {
      const keys = Object.keys(value).sort(compareCodePoints);
      if (keys.length === 0) record(kind, pointer, kind === "removed" ? {} : undefined, kind === "added" ? {} : undefined);
      for (const key of keys) {
        visitMissing(kind, value[key], `${pointer}/${escapeJsonPointer(key)}`);
        if (truncated) return;
      }
      return;
    }
    record(kind, pointer, kind === "removed" ? value : undefined, kind === "added" ? value : undefined);
  }

  function record(kind, pointer, left, right) {
    if (changes.length >= maxChanges) {
      truncated = true;
      return;
    }
    counts[kind] += 1;
    changes.push({
      kind,
      path: pointer || "/",
      ...(kind !== "added" ? { before: left } : {}),
      ...(kind !== "removed" ? { after: right } : {})
    });
  }
}

export function normalizeSourceText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildSourceDocument(input) {
  const normalizedText = normalizeSourceText(input.fullText);
  if (normalizedText.length < 280) {
    throw new Error(`Source document ${input.policyId ?? "unknown"} is missing usable full text.`);
  }

  const sourceBlocks = splitSourceBlocks(normalizedText);
  const headingStack = [];
  const segments = [];
  let searchOffset = 0;

  for (const [blockIndex, block] of sourceBlocks.entries()) {
    const headingLevel = inferHeadingLevel(block);
    if (headingLevel) {
      headingStack.length = headingLevel - 1;
      headingStack[headingLevel - 1] = firstSourceLine(block);
    }
    const headingPath = headingStack.filter(Boolean);
    const chunks = splitLongSourceBlock(block);

    for (const [chunkIndex, text] of chunks.entries()) {
      const locatedAt = normalizedText.indexOf(text, searchOffset);
      const charStart = locatedAt >= 0 ? locatedAt : normalizedText.indexOf(text);
      const safeStart = charStart >= 0 ? charStart : searchOffset;
      const charEnd = safeStart + text.length;
      searchOffset = charEnd;
      const sortOrder = segments.length + 1;
      segments.push({
        segmentKey: `segment-${String(sortOrder).padStart(4, "0")}`,
        sortOrder,
        headingLevel: chunkIndex === 0 ? headingLevel : null,
        headingPath,
        pageNumber: null,
        sourceLocator: {
          blockIndex: blockIndex + 1,
          chunkIndex: chunkIndex + 1,
          charStart: safeStart,
          charEnd
        },
        text,
        segmentHash: sha256Text(text)
      });
    }
  }

  return {
    policyId: requiredString(input.policyId, "source policyId"),
    sourceUrl: nullableString(input.sourceUrl),
    normalizedText,
    sourceDocumentHash: sha256Text(normalizedText),
    parserVersion: input.parserVersion || SOURCE_PARSER_VERSION,
    fetchedAt: nullableString(input.fetchedAt),
    officialPublishedAt: nullableString(input.officialPublishedAt),
    metadata: isRecord(input.metadata) ? input.metadata : {},
    segments
  };
}

export function projectReport(report, options = {}) {
  const policyId = getPolicyId(report);
  const projectionVersion = options.projectionVersion || PROJECTION_VERSION;
  const companiesById = new Map(
    array(report.companies).map((company, index) => [
      entityKey(company, `company-${index + 1}`),
      company
    ])
  );

  const policyActions = array(report.actions).map((item, index) => ({
    policyId,
    actionKey: entityKey(item, `action-${index + 1}`),
    title: text(item.title),
    body: nullableString(item.body),
    signal: normalizeSignal(item.signal),
    actionType: nullableString(item.actionType ?? item.action_type),
    evidenceLevel: normalizeEvidence(item.actionEvidenceLevel ?? item.action_evidence_level),
    implementationDependency: nullableString(item.implementationDependency ?? item.implementation_dependency),
    confidence: nullableNumber(item.confidence),
    clauseKeys: stringArray(item.clauseIds ?? item.clause_ids),
    sortOrder: integer(item.sortOrder ?? item.sort_order, index + 1),
    payloadFragment: item
  }));

  const industryNodes = array(report.chainNodes ?? report.chain_nodes).map((item, index) => ({
    policyId,
    nodeKey: entityKey(item, `node-${index + 1}`),
    title: text(item.title),
    subtitle: nullableString(item.subtitle),
    section: normalizeSection(item.section),
    relation: normalizeRelation(item.relation),
    evidenceLevel: normalizeEvidence(item.industryNodeEvidenceLevel ?? item.industry_node_evidence_level ?? item.evidenceLevel ?? item.evidence_level ?? item.evidence),
    confidence: nullableNumber(item.confidence),
    description: nullableString(item.description),
    clauseKeys: stringArray(item.clauseIds ?? item.clause_ids ?? item.clauses),
    companyKeys: stringArray(item.companyIds ?? item.company_ids ?? item.companies),
    verificationSignals: stringArray(item.verificationSignals ?? item.verification_signals),
    sortOrder: integer(item.sortOrder ?? item.sort_order, index + 1),
    payloadFragment: item
  }));

  const industryEdges = array(report.chainEdges ?? report.chain_edges).map((item, index) => ({
    policyId,
    edgeKey: entityKey(item, `edge-${index + 1}`),
    fromNodeKey: requiredString(item.from ?? item.fromNodeId ?? item.from_node_id, `edge ${index + 1} from`),
    toNodeKey: requiredString(item.to ?? item.toNodeId ?? item.to_node_id, `edge ${index + 1} to`),
    edgeType: normalizeEdgeType(item.type ?? item.edgeType ?? item.edge_type),
    confidence: nullableNumber(item.confidence),
    description: nullableString(item.reason ?? item.description),
    sortOrder: integer(item.sortOrder ?? item.sort_order, index + 1),
    payloadFragment: item
  }));

  const companyRelations = buildCompanyRelations(report, policyId, companiesById);
  const knownCompanyKeys = new Set(companiesById.keys());
  const companyIdAliases = new Map([...knownCompanyKeys].map((key) => [key, key]));
  for (const relation of companyRelations) {
    knownCompanyKeys.add(relation.companyKey);
    companyIdAliases.set(relation.companyKey, relation.companyKey);
    if (relation.sourceCompanyId) companyIdAliases.set(relation.sourceCompanyId, relation.companyKey);
  }

  const policyNetworkRelations = array(report.policyNetwork ?? report.policy_network).map((item, index) => ({
    policyId,
    relationKey: entityKey(item, `policy-network-${index + 1}`),
    relatedPolicyKey: nullableString(item.relatedPolicyId ?? item.related_policy_id),
    relatedPolicyTitle: requiredString(item.relatedPolicy ?? item.related_policy, `policy network ${index + 1} title`),
    relationship: normalizePolicyRelationship(item.relationship),
    meaning: nullableString(item.meaning),
    evidenceLevel: normalizeEvidence(item.evidenceLevel ?? item.evidence_level),
    sourceDate: nullableString(item.sourceDate ?? item.source_date),
    sourceUrl: nullableString(item.sourceUrl ?? item.source_url),
    watchSignals: stringArray(item.watchSignals ?? item.watch_signals),
    sortOrder: integer(item.sortOrder ?? item.sort_order, index + 1),
    payloadFragment: item
  }));

  const evidenceRefs = array(report.evidence).map((item, index) => ({
    policyId,
    evidenceKey: entityKey(item, `evidence-${index + 1}`),
    title: text(item.title),
    sourceName: nullableString(item.source ?? item.sourceName ?? item.source_name),
    evidenceType: nullableString(item.type ?? item.evidenceType ?? item.evidence_type),
    evidenceObject: nullableString(item.evidenceObject ?? item.evidence_object),
    publishedAt: nullableString(item.date ?? item.publishedAt ?? item.published_at),
    sourceUrl: nullableString(item.url ?? item.sourceUrl ?? item.source_url),
    excerpt: nullableString(item.excerpt),
    interpretation: nullableString(item.interpretation),
    sourceLocation: nullableString(item.sourceLocation ?? item.source_location),
    confidence: nullableNumber(item.confidence),
    linkedClauseKeys: stringArray(item.clauseIds ?? item.clause_ids),
    linkedNodeKeys: stringArray(item.nodeIds ?? item.node_ids),
    linkedCompanyKeys: stringArray(item.companyIds ?? item.company_ids).map((key) => companyIdAliases.get(key) ?? key),
    sortOrder: integer(item.sortOrder ?? item.sort_order, index + 1),
    payloadFragment: item
  }));

  const signals = buildSignals(report, policyId, companyRelations);
  const projection = {
    projectionVersion,
    policyId,
    policyActions,
    industryNodes,
    industryEdges,
    companyRelations,
    policyNetworkRelations,
    evidenceRefs,
    signals
  };

  validateProjection(projection, { knownCompanyKeys });
  return {
    ...projection,
    projectionHash: hashJson(projection),
    counts: {
      policyActions: policyActions.length,
      industryNodes: industryNodes.length,
      industryEdges: industryEdges.length,
      companyRelations: companyRelations.length,
      policyNetworkRelations: policyNetworkRelations.length,
      evidenceRefs: evidenceRefs.length,
      signals: signals.length
    }
  };
}

export function buildShadowRevision(report, options = {}) {
  const policyId = getPolicyId(report);
  const sourceDocument = options.sourceDocument ?? null;
  const projection = projectReport(report, options);
  const contentHash = hashJson(report);
  const payloadRoundTripHash = hashJson(JSON.parse(JSON.stringify(report)));
  if (payloadRoundTripHash !== contentHash) {
    throw new Error(`Report ${policyId} changed during JSON round-trip.`);
  }

  return {
    policyId,
    parentRevisionId: null,
    status: "draft",
    payload: report,
    schemaVersion: options.schemaVersion || REPORT_SCHEMA_VERSION,
    analysisVersion: nullableString(report.analysisMethod ?? report.analysis_method ?? report.analyzerVersion ?? report.analyzer_version) || "unknown",
    projectionVersion: projection.projectionVersion,
    sourceDocumentHash: sourceDocument?.sourceDocumentHash ?? null,
    sourceDocumentStatus: sourceDocument
      ? isVerifiedSourceDocument(sourceDocument)
        ? "verified"
        : "candidate_pending_production_crosscheck"
      : "missing",
    contentHash,
    projectionHash: projection.projectionHash,
    changeSummary: "Initial immutable shadow revision migrated from the reviewed repository report.",
    changeReason: "stage-7-initial-shadow-migration",
    generatedAt: nullableString(report.generatedAt ?? report.generated_at),
    projection
  };
}

export function buildShadowPackage(reports, options = {}) {
  const sourceDocuments = new Map(
    array(options.sourceDocuments).map((item) => {
      const document = item.sourceDocumentHash ? item : buildSourceDocument(item);
      return [document.policyId, document];
    })
  );
  const revisions = reports.map((report) => buildShadowRevision(report, {
    ...options,
    sourceDocument: sourceDocuments.get(getPolicyId(report)) ?? null
  }));
  assertUnique(revisions, (item) => item.policyId, "shadow policyId");
  assertUnique(revisions, (item) => `${item.policyId}:${item.contentHash}`, "shadow revision content hash");

  return {
    formatVersion: "stage7-shadow-package-v1",
    reportSchemaVersion: options.schemaVersion || REPORT_SCHEMA_VERSION,
    projectionVersion: options.projectionVersion || PROJECTION_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    sourceCandidateReady: revisions.every((item) => item.sourceDocumentStatus !== "missing"),
    deploymentReady: revisions.every((item) => item.sourceDocumentStatus === "verified"),
    counts: {
      reports: revisions.length,
      sourceDocuments: sourceDocuments.size,
      verifiedSourceDocuments: revisions.filter((item) => item.sourceDocumentStatus === "verified").length,
      candidateSourceDocuments: revisions.filter((item) => item.sourceDocumentStatus === "candidate_pending_production_crosscheck").length,
      missingSourceDocuments: revisions.filter((item) => item.sourceDocumentStatus === "missing").length,
      policyActions: sum(revisions, "policyActions"),
      industryNodes: sum(revisions, "industryNodes"),
      industryEdges: sum(revisions, "industryEdges"),
      companyRelations: sum(revisions, "companyRelations"),
      policyNetworkRelations: sum(revisions, "policyNetworkRelations"),
      evidenceRefs: sum(revisions, "evidenceRefs"),
      signals: sum(revisions, "signals")
    },
    sourceDocuments: [...sourceDocuments.values()],
    revisions
  };
}

export function validateProjection(projection, options = {}) {
  assertUnique(projection.policyActions, (item) => item.actionKey, "action key");
  assertUnique(projection.industryNodes, (item) => item.nodeKey, "industry node key");
  assertUnique(projection.industryEdges, (item) => item.edgeKey, "industry edge key");
  assertUnique(projection.companyRelations, (item) => item.relationKey, "company relation key");
  assertUnique(projection.policyNetworkRelations, (item) => item.relationKey, "policy network relation key");
  assertUnique(projection.evidenceRefs, (item) => item.evidenceKey, "evidence key");
  assertUnique(projection.signals, (item) => item.signalKey, "signal key");

  const nodeKeys = new Set(projection.industryNodes.map((item) => item.nodeKey));
  for (const edge of projection.industryEdges) {
    if (!nodeKeys.has(edge.fromNodeKey) || !nodeKeys.has(edge.toNodeKey)) {
      throw new Error(`Projection ${projection.policyId} edge ${edge.edgeKey} references an unknown node.`);
    }
    if (edge.fromNodeKey === edge.toNodeKey) {
      throw new Error(`Projection ${projection.policyId} edge ${edge.edgeKey} cannot be self-referential.`);
    }
  }

  for (const relation of projection.companyRelations) {
    if (relation.chainNodeKey && !nodeKeys.has(relation.chainNodeKey)) {
      throw new Error(`Projection ${projection.policyId} company relation ${relation.relationKey} references unknown node ${relation.chainNodeKey}.`);
    }
  }

  const companyKeys = options.knownCompanyKeys ?? new Set(projection.companyRelations.map((item) => item.companyKey));
  for (const evidence of projection.evidenceRefs) {
    for (const nodeKey of evidence.linkedNodeKeys) {
      if (!nodeKeys.has(nodeKey)) {
        throw new Error(`Projection ${projection.policyId} evidence ${evidence.evidenceKey} references unknown node ${nodeKey}.`);
      }
    }
    for (const companyKey of evidence.linkedCompanyKeys) {
      if (!companyKeys.has(companyKey)) {
        throw new Error(`Projection ${projection.policyId} evidence ${evidence.evidenceKey} references unknown company ${companyKey}.`);
      }
    }
  }
}

function buildCompanyRelations(report, policyId, companiesById) {
  const mappings = array(report.companyMap ?? report.company_map);
  if (mappings.length > 0) {
    return mappings.map((item, index) => {
      const sourceCompanyId = nullableString(item.companyId ?? item.company_id);
      const company = sourceCompanyId ? companiesById.get(sourceCompanyId) : null;
      const companyKey = sourceCompanyId || entityKey(company ?? item, `company-${index + 1}`);
      return {
        policyId,
        relationKey: entityKey(item, `company-relation-${index + 1}`),
        companyKey,
        sourceCompanyId,
        companyName: requiredString(item.company ?? company?.name, `company relation ${index + 1} name`),
        ticker: nullableString(item.ticker ?? company?.ticker),
        chainNodeKey: nullableString(item.chainNodeId ?? item.chain_node_id),
        relationship: normalizeMappingLevel(item.relationship ?? company?.mappingLevel ?? company?.mapping_level ?? company?.relation),
        policyEvidence: normalizeEvidence(item.policyEvidence ?? item.policy_evidence ?? company?.companyMappingEvidenceLevel ?? company?.company_mapping_evidence_level ?? company?.evidenceLevel ?? company?.evidence),
        regulatoryRole: normalizeRegulatoryRole(item.regulatoryRole ?? item.regulatory_role ?? company?.regulatoryRole ?? company?.regulatory_role),
        businessExposure: nullableString(item.businessExposure ?? item.business_exposure ?? company?.reason),
        investmentUse: nullableString(item.investmentUse ?? item.investment_use ?? company?.selectionBasis ?? company?.selection_basis),
        watchSignals: stringArray(item.watchSignals ?? item.watch_signals),
        keyRisks: stringArray(item.keyRisks ?? item.key_risks ?? company?.riskFactors ?? company?.risk_factors),
        doNotOverread: stringArray(item.doNotOverread ?? item.do_not_overread),
        sortOrder: integer(item.sortOrder ?? item.sort_order, index + 1),
        payloadFragment: item
      };
    });
  }

  return array(report.companies).map((company, index) => ({
    policyId,
    relationKey: `legacy-company-relation-${index + 1}`,
    companyKey: entityKey(company, `company-${index + 1}`),
    sourceCompanyId: entityKey(company, `company-${index + 1}`),
    companyName: requiredString(company.name, `legacy company ${index + 1} name`),
    ticker: nullableString(company.ticker),
    chainNodeKey: stringArray(company.nodeIds ?? company.node_ids)[0] ?? null,
    relationship: normalizeMappingLevel(company.mappingLevel ?? company.mapping_level ?? company.relation),
    policyEvidence: normalizeEvidence(company.companyMappingEvidenceLevel ?? company.company_mapping_evidence_level ?? company.evidenceLevel ?? company.evidence),
    regulatoryRole: normalizeRegulatoryRole(company.regulatoryRole ?? company.regulatory_role),
    businessExposure: nullableString(company.reason),
    investmentUse: nullableString(company.selectionBasis ?? company.selection_basis),
    watchSignals: [],
    keyRisks: stringArray(company.riskFactors ?? company.risk_factors),
    doNotOverread: [],
    sortOrder: index + 1,
    payloadFragment: company
  }));
}

function buildSignals(report, policyId, companyRelations) {
  const rows = [];
  const investment = isRecord(report.investmentDirection ?? report.investment_direction)
    ? report.investmentDirection ?? report.investment_direction
    : {};
  const primaryDirection = nullableString(investment.primaryDirection ?? investment.primary_direction);
  if (primaryDirection) {
    rows.push({
      policyId,
      signalKey: "investment-primary-direction",
      signalType: "investment_direction",
      subjectType: "policy",
      subjectKey: policyId,
      signalValue: primaryDirection,
      direction: "pending",
      strength: normalizeStrength(investment.directionStrength ?? investment.direction_strength),
      timeHorizon: normalizeTimeHorizon(investment.timeHorizon ?? investment.time_horizon),
      summary: nullableString(investment.summary),
      sortOrder: rows.length + 1
    });
  }

  appendSignals(rows, policyId, "follow_up", array(report.followUpSignals ?? report.follow_up_signals), "policy", policyId);
  appendSignals(rows, policyId, "catalyst", array(investment.nearTermCatalysts ?? investment.near_term_catalysts), "policy", policyId);
  appendSignals(rows, policyId, "risk", array(investment.keyRisks ?? investment.key_risks), "policy", policyId, "constraint");
  appendSignals(rows, policyId, "boundary", array(investment.doNotOverread ?? investment.do_not_overread), "policy", policyId, "constraint");

  for (const relation of companyRelations) {
    appendSignals(rows, policyId, "company_watch", relation.watchSignals, "company", relation.companyKey);
    appendSignals(rows, policyId, "company_risk", relation.keyRisks, "company", relation.companyKey, "constraint");
  }

  return rows.map((item, index) => ({ ...item, sortOrder: index + 1 }));
}

function appendSignals(rows, policyId, type, values, subjectType, subjectKey, direction = "pending") {
  for (const value of stringArray(values)) {
    rows.push({
      policyId,
      signalKey: `${type}:${subjectType}:${slug(subjectKey)}:${String(rows.length + 1).padStart(4, "0")}`,
      signalType: type,
      subjectType,
      subjectKey,
      signalValue: value,
      direction,
      strength: "pending",
      timeHorizon: "uncertain",
      summary: null,
      sortOrder: rows.length + 1
    });
  }
}

function splitSourceBlocks(value) {
  const normalized = String(value ?? "");
  let blocks = normalized
    .split(/\n\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (blocks.length === 1 && normalized.includes("\n")) {
    blocks = normalized
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return blocks;
}

function splitLongSourceBlock(value, maxLength = MAX_SOURCE_SEGMENT_LENGTH) {
  const source = String(value ?? "").trim();
  if (!source) return [];
  if (source.length <= maxLength) return [source];

  const chunks = [];
  let start = 0;
  while (source.length - start > maxLength) {
    const hardEnd = start + maxLength;
    const softStart = start + Math.floor(maxLength * 0.55);
    let splitAt = -1;

    for (let index = hardEnd; index >= softStart; index -= 1) {
      if (/[。！？；.!?;\n]/.test(source[index - 1] ?? "")) {
        splitAt = index;
        break;
      }
    }

    if (splitAt < 0) splitAt = hardEnd;
    const chunk = source.slice(start, splitAt).trim();
    if (chunk) chunks.push(chunk);
    start = splitAt;
    while (start < source.length && /\s/.test(source[start])) start += 1;
  }

  const tail = source.slice(start).trim();
  if (tail) chunks.push(tail);
  return chunks;
}

function firstSourceLine(value) {
  const line = String(value ?? "").split("\n", 1)[0].trim();
  return line.length <= 120 ? line : `${line.slice(0, 117)}...`;
}

function compareCodePoints(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function escapeJsonPointer(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function inferHeadingLevel(textValue) {
  const firstLine = String(textValue).split("\n", 1)[0].trim();
  if (/^第[一二三四五六七八九十百]+[章节编]/.test(firstLine)) return 1;
  if (/^[一二三四五六七八九十]+、/.test(firstLine)) return 2;
  if (/^（[一二三四五六七八九十]+）/.test(firstLine)) return 3;
  if (/^\d+[.、]/.test(firstLine)) return 4;
  return null;
}

function getPolicyId(report) {
  return requiredString(report.policyId ?? report.policy_id ?? report.id ?? report.summary?.id, "report policyId");
}

function entityKey(value, fallback) {
  return nullableString(value?.id ?? value?.key ?? value?.externalId ?? value?.external_id) || fallback;
}

function requiredString(value, label) {
  const normalized = nullableString(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function nullableString(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function text(value) {
  return nullableString(value) ?? "";
}

function nullableNumber(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function integer(value, fallback) {
  const numeric = nullableNumber(value);
  return numeric === null ? fallback : Math.trunc(numeric);
}

function stringArray(value) {
  return array(value).map(nullableString).filter(Boolean);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeSignal(value) {
  const token = slug(value);
  if (["positive", "benefit", "beneficiary", "利好", "正向"].includes(token)) return "positive";
  if (["constraint", "restriction", "约束"].includes(token)) return "constraint";
  if (["risk", "风险"].includes(token)) return "risk";
  if (["neutral", "中性"].includes(token)) return "neutral";
  return "pending";
}

function normalizeSection(value) {
  const token = slug(value);
  return ["upstream", "midstream", "downstream", "support"].includes(token) ? token : "support";
}

function normalizeRelation(value) {
  const token = slug(value);
  const map = {
    direct: "direct",
    "直接相关": "direct",
    indirect: "indirect",
    "间接相关": "indirect",
    beneficiary: "beneficiary",
    benefit: "beneficiary",
    "潜在受益": "beneficiary",
    constraint: "constraint_risk",
    constraint_risk: "constraint_risk",
    risk: "constraint_risk",
    "约束风险": "constraint_risk",
    pending: "pending",
    "待验证": "pending"
  };
  return map[token] ?? "pending";
}

function normalizeEvidence(value) {
  const token = slug(value);
  if (["strong", "high", "强证据"].includes(token)) return "strong";
  if (["indirect", "medium", "间接证据"].includes(token)) return "indirect";
  return "pending";
}

function normalizeEdgeType(value) {
  const token = slug(value);
  return ["strong", "medium", "weak", "risk"].includes(token) ? token : "medium";
}

function normalizeMappingLevel(value) {
  const token = slug(value);
  if (["policy_named", "direct_industry", "indirect_industry", "thematic_only", "watch_only"].includes(token)) return token;
  if (token === "direct" || token === "直接相关") return "direct_industry";
  if (token === "indirect" || token === "间接相关") return "indirect_industry";
  return "watch_only";
}

function normalizeRegulatoryRole(value) {
  const token = slug(value);
  return ["constraint_exposed", "compliance_provider", "mixed", "not_applicable"].includes(token) ? token : "not_applicable";
}

function normalizePolicyRelationship(value) {
  const token = slug(value);
  const allowed = ["upstream_guidance", "downstream_implementation", "supporting_rule", "prior_policy", "follow_up_catalyst", "local_rollout", "contrast_policy"];
  return allowed.includes(token) ? token : "supporting_rule";
}

function normalizeStrength(value) {
  const token = slug(value);
  return ["high", "medium", "low", "pending"].includes(token) ? token : "pending";
}

function normalizeTimeHorizon(value) {
  const token = slug(value);
  return ["short_term", "medium_term", "long_term", "uncertain"].includes(token) ? token : "uncertain";
}

function slug(value) {
  return nullableString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
}

function assertUnique(items, selector, label) {
  const seen = new Set();
  for (const item of items) {
    const key = selector(item);
    if (seen.has(key)) throw new Error(`Duplicate ${label}: ${key}`);
    seen.add(key);
  }
}

function isVerifiedSourceDocument(document) {
  const status = nullableString(document?.metadata?.verificationStatus);
  return ["official_source_verified", "production_crosschecked", "verified"].includes(status);
}

function sum(revisions, key) {
  return revisions.reduce((total, revision) => total + Number(revision.projection.counts[key] ?? 0), 0);
}
