import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const RESEARCH_INDEX_SCHEMA_VERSION = "stage10-research-index-v1.0";
export const DEFAULT_RESEARCH_INDEX_PATH = "research-index/research-index.json";
export const RELATION_LEVELS = [
  "policy_named",
  "direct_industry",
  "indirect_industry",
  "thematic_only",
  "watch_only"
];

const DEFAULT_PATHS = {
  manualReports: "manual-reports",
  extraReports: ["research-batches/stage9-first-six/reports"],
  stage9Manifest: "research-batches/stage9-first-six/batch-manifest.json",
  aliases: "research-index/industry-aliases.json",
  relationEvents: "research-index/relation-events.json",
  watchlist: "research-index/watchlist.json"
};

const DISCLAIMER = "政策覆盖次数不等于订单数量、收入增量或投资价值；本索引只用于内部研究注意力管理，不构成交易建议。";

function asArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== "");
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

export function normalizeResearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s《》“”"'（）()，,。.;；:：\-—_\/\\]/g, "");
}

function contentHash(value) {
  const input = typeof value === "string" ? value : JSON.stringify(value);
  return crypto.createHash("sha256").update(input).digest("hex");
}

function stableId(prefix, ...parts) {
  return prefix + "-" + contentHash(parts.map((part) => String(part ?? "")).join("|")).slice(0, 20);
}

async function readJson(absolutePath, optional = false) {
  try {
    return JSON.parse(await fs.readFile(absolutePath, "utf8"));
  } catch (error) {
    if (optional && error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function listJsonFiles(absoluteDirectory) {
  try {
    const names = await fs.readdir(absoluteDirectory);
    return names
      .filter((name) => name.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => path.join(absoluteDirectory, name));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function reportStatusRank(report) {
  const status = normalizeResearchText(report.policy?.status ?? report.summary?.status ?? report.status);
  if (["current", "active", "published", "已发布", "有效"].some((value) => status.includes(normalizeResearchText(value)))) return 4;
  if (status.includes("draft") || status.includes("候选")) return 3;
  if (status.includes("superseded") || status.includes("历史")) return 2;
  if (status.includes("invalid") || status.includes("废止") || status.includes("withdrawn")) return 0;
  return 1;
}

function reportVersionNumber(report) {
  const candidate = report.reportVersion ?? report.revision ?? report.version ?? 0;
  const match = String(candidate).match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function reportTimestamp(report) {
  const value = report.generatedAt ?? report.updatedAt ?? report.policy?.officialPublishedAt ?? report.policy?.publishDateTime ?? report.policy?.publishDate;
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function selectCurrentReport(entries) {
  return [...entries].sort((left, right) => {
    const rank = reportStatusRank(right.report) - reportStatusRank(left.report);
    if (rank) return rank;
    const version = reportVersionNumber(right.report) - reportVersionNumber(left.report);
    if (version) return version;
    const time = reportTimestamp(right.report) - reportTimestamp(left.report);
    if (time) return time;
    const manual = Number(right.reportSource === "manual_report") - Number(left.reportSource === "manual_report");
    if (manual) return manual;
    return left.reportPath.localeCompare(right.reportPath);
  })[0];
}

function stablePolicyKey(report, reportPath) {
  return String(
    report.policyId ??
    report.id ??
    report.policy?.canonicalSourceUrl ??
    report.policy?.sourceUrl ??
    report.policy?.title ??
    report.summary?.title ??
    reportPath
  );
}

function reportVersionLabel(report) {
  const explicit = report.reportVersion ?? report.revision ?? report.version;
  if (explicit !== undefined && explicit !== null) return String(explicit);
  const analyzer = report.analyzerVersion ?? report.analysisMethod ?? "unversioned";
  return report.generatedAt ? analyzer + "@" + report.generatedAt : analyzer;
}

export async function loadResearchInputs(root = process.cwd(), overrides = {}) {
  const paths = { ...DEFAULT_PATHS, ...overrides };
  const manifest = await readJson(path.resolve(root, paths.stage9Manifest), true);
  const aliases = await readJson(path.resolve(root, paths.aliases));
  const relationEvents = await readJson(path.resolve(root, paths.relationEvents));
  const watchlist = await readJson(path.resolve(root, paths.watchlist));
  const manifestByPath = new Map(
    (manifest?.policies ?? []).map((item) => [normalizePath(item.reportPath), item])
  );

  const sources = [
    { directory: paths.manualReports, reportSource: "manual_report" },
    ...paths.extraReports.map((directory) => ({ directory, reportSource: "research_batch_candidate" }))
  ];
  const candidates = [];
  for (const source of sources) {
    for (const absolutePath of await listJsonFiles(path.resolve(root, source.directory))) {
      const raw = await fs.readFile(absolutePath, "utf8");
      const report = JSON.parse(raw);
      const reportPath = normalizePath(path.relative(root, absolutePath));
      candidates.push({
        report,
        reportPath,
        reportSource: source.reportSource,
        manifest: manifestByPath.get(reportPath) ?? null,
        sourceContentHash: contentHash(raw.replace(/\r\n?/g, "\n")),
        stablePolicyKey: stablePolicyKey(report, reportPath)
      });
    }
  }

  const grouped = new Map();
  for (const candidate of candidates) {
    const key = candidate.stablePolicyKey;
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }
  const selected = [...grouped.values()]
    .map(selectCurrentReport)
    .sort((left, right) => left.reportPath.localeCompare(right.reportPath));
  const deduplication = [...grouped.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([policyKey, entries]) => {
      const chosen = selectCurrentReport(entries);
      return {
        policyKey,
        selectedReportPath: chosen.reportPath,
        omittedReportPaths: entries.filter((entry) => entry !== chosen).map((entry) => entry.reportPath).sort()
      };
    });

  return {
    paths,
    manifest,
    aliases,
    relationEvents,
    watchlist,
    candidates,
    selected,
    deduplication
  };
}

function normalizeIndustryName(originalName, aliasConfig) {
  const normalized = normalizeResearchText(originalName);
  const exactMatches = [];
  const containsMatches = [];
  for (const record of aliasConfig.aliases ?? []) {
    for (const alias of unique([record.canonicalName, ...(record.aliases ?? [])])) {
      const normalizedAlias = normalizeResearchText(alias);
      if (!normalizedAlias) continue;
      if (normalized === normalizedAlias) exactMatches.push({ canonicalName: record.canonicalName, alias });
      else if (record.matchMode === "contains" && normalized.includes(normalizedAlias)) {
        containsMatches.push({ canonicalName: record.canonicalName, alias });
      }
    }
  }
  const candidates = exactMatches.length ? exactMatches : containsMatches;
  const canonicalMatches = unique(candidates.map((item) => item.canonicalName));
  if (canonicalMatches.length === 1) {
    return {
      originalName,
      canonicalName: canonicalMatches[0],
      status: exactMatches.length ? "exact_alias" : "contains_alias",
      matchedAliases: unique(candidates.map((item) => item.alias))
    };
  }
  if (canonicalMatches.length > 1) {
    return {
      originalName,
      canonicalName: originalName,
      status: "conflict",
      matchedAliases: unique(candidates.map((item) => item.alias)),
      candidates: canonicalMatches
    };
  }
  return {
    originalName,
    canonicalName: originalName,
    status: "unchanged",
    matchedAliases: []
  };
}

function normalizeCompanyKey(company) {
  const ticker = String(company.ticker ?? "").trim().toUpperCase();
  if (ticker && !/未上市|非上市|N\/A|NONE/i.test(ticker)) return "ticker:" + ticker;
  const compactName = normalizeResearchText(company.name)
    .replace(/集团股份有限公司|股份有限公司|有限责任公司|有限公司/g, "");
  return "name:" + (compactName || normalizeResearchText(company.name));
}

function normalizeRelationLevel(company, mapping) {
  if (company.officialMention) return "policy_named";
  const raw = normalizeResearchText(mapping.relationship ?? company.mappingLevel ?? company.relation);
  const direct = {
    policynamed: "policy_named",
    directindustry: "direct_industry",
    indirectindustry: "indirect_industry",
    thematiconly: "thematic_only",
    watchonly: "watch_only"
  };
  if (direct[raw]) return direct[raw];
  if (raw.includes("indirect")) return "indirect_industry";
  if (raw.includes("direct")) return "direct_industry";
  if (raw.includes("theme")) return "thematic_only";
  return "watch_only";
}

function structuredDate(value) {
  if (!value) return { date: null, dateRange: null, datePrecision: "unknown", uncertainty: "date_not_stated" };
  const text = String(value).trim();
  let match = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (match) {
    const date = match[1] + "-" + String(match[2]).padStart(2, "0") + "-" + String(match[3]).padStart(2, "0");
    return { date, dateRange: null, datePrecision: "day", uncertainty: null };
  }
  match = text.match(/(20\d{2})[-/.年](\d{1,2})月?/);
  if (match) {
    const date = match[1] + "-" + String(match[2]).padStart(2, "0");
    return { date, dateRange: null, datePrecision: "month", uncertainty: "day_not_stated" };
  }
  match = text.match(/(20\d{2})\s*[—–-]\s*(20\d{2})年?/);
  if (match) {
    return {
      date: null,
      dateRange: { start: match[1], end: match[2] },
      datePrecision: "year_range",
      uncertainty: "exact_dates_not_stated"
    };
  }
  match = text.match(/(20\d{2})年?/);
  if (match) return { date: match[1], dateRange: null, datePrecision: "year", uncertainty: "month_and_day_not_stated" };
  return { date: null, dateRange: null, datePrecision: "unknown", uncertainty: "date_not_stated" };
}

function classifyEventType(description) {
  const text = normalizeResearchText(description);
  if (/截止|申报/.test(text)) return "application_deadline";
  if (/验收|测评|认证|验证/.test(text)) return "evaluation_acceptance";
  if (/名单|入选|遴选结果/.test(text)) return "list_announcement";
  if (/标准|制修订/.test(text)) return "standard_cycle";
  if (/价格|电价|水价|执行文件/.test(text)) return "price_execution";
  if (/订单|合同|中标|采购|招标|公告/.test(text)) return "company_validation";
  if (/完成|期限|攻关|中试/.test(text)) return "project_completion";
  return "follow_up";
}

function eventSortKey(event) {
  return event.date ?? event.dateRange?.start ?? "9999-99-99";
}

function continuityAssessment(relations) {
  const policyIds = unique(relations.map((relation) => relation.policyId));
  if (policyIds.length < 2) {
    return { status: "insufficient_history", reason: "少于两份独立政策，不能判断连续强化或重复表态。" };
  }
  const directStrong = unique(
    relations
      .filter((relation) => relation.policyCloseness === "direct" && relation.evidenceLevel === "strong")
      .map((relation) => relation.policyId)
  ).length;
  const actionText = normalizeResearchText(unique(relations.flatMap((relation) => relation.policyTools)).join(" "));
  if (directStrong >= 2) {
    return {
      status: "continuous_strengthening_candidate",
      reason: "至少两份独立政策提供直接且强证据的工具作用；仍需结合执行文件和兑现事件人工复核。"
    };
  }
  if (/规划|意见|行动方案/.test(actionText) && directStrong === 0) {
    return {
      status: "repeated_expression_candidate",
      reason: "多政策主要停留在规划或意见层，尚无直接强工具证据。"
    };
  }
  return {
    status: "mixed_or_indeterminate",
    reason: "政策工具和证据层级混合，不能仅凭覆盖次数判断强化。"
  };
}

function validateRelationEvents(config, companyRelations, evidence, policies) {
  const errors = [];
  const warnings = [];
  const allowedTypes = new Set(config.allowedChangeTypes ?? []);
  const ids = new Set();
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  const policyById = new Map(policies.map((item) => [item.policyId, item]));
  const enriched = [];
  for (const event of config.events ?? []) {
    if (!event.eventId || ids.has(event.eventId)) errors.push("duplicate_or_missing_event_id:" + String(event.eventId));
    ids.add(event.eventId);
    if (!allowedTypes.has(event.changeType)) errors.push("unsupported_change_type:" + event.eventId);
    if (event.toLevel && !RELATION_LEVELS.includes(event.toLevel)) errors.push("unsupported_to_level:" + event.eventId);
    if (event.fromLevel && !RELATION_LEVELS.includes(event.fromLevel)) errors.push("unsupported_from_level:" + event.eventId);
    if (!policyById.has(event.policyId)) errors.push("unknown_policy:" + event.eventId);
    for (const evidenceId of event.evidenceIds ?? []) {
      if (!evidenceIds.has(evidenceId)) errors.push("unknown_evidence:" + event.eventId + ":" + evidenceId);
    }
    const relation = companyRelations.find(
      (item) => item.policyId === event.policyId && item.companyKey === event.companyKey
    );
    if (!relation) warnings.push("relation_not_in_current_index:" + event.eventId);
    else if (event.toLevel && relation.relationship !== event.toLevel) {
      warnings.push("event_target_differs_from_current_relation:" + event.eventId);
    }
    enriched.push({
      ...event,
      policyTitle: policyById.get(event.policyId)?.title ?? "",
      currentRelationship: relation?.relationship ?? null,
      currentEvidenceIds: relation?.evidenceIds ?? []
    });
  }
  enriched.sort((left, right) => String(left.effectiveAt).localeCompare(String(right.effectiveAt)) || left.eventId.localeCompare(right.eventId));
  return { events: enriched, validation: { valid: errors.length === 0, errors, warnings } };
}

function validateWatchlist(config, references) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const allowedStatuses = new Set(config.allowedStatuses ?? []);
  if (!Number.isInteger(config.capacity) || config.capacity < 1) errors.push("invalid_capacity");
  if ((config.objects ?? []).length > config.capacity) errors.push("capacity_exceeded");
  for (const item of config.objects ?? []) {
    if (!item.objectId || ids.has(item.objectId)) errors.push("duplicate_or_missing_object_id:" + String(item.objectId));
    ids.add(item.objectId);
    if (!allowedStatuses.has(item.status)) errors.push("invalid_status:" + item.objectId);
    for (const field of ["objectType", "displayName", "attentionLevel", "evidenceState", "nextReviewDate"]) {
      if (!item[field]) errors.push("missing_" + field + ":" + item.objectId);
    }
    if (!asArray(item.reasons).length) errors.push("missing_reasons:" + item.objectId);
    if (!asArray(item.triggerRules).length) warnings.push("missing_trigger_rules:" + item.objectId);
    if (!asArray(item.invalidationRules).length) warnings.push("missing_invalidation_rules:" + item.objectId);
    if (item.objectType === "company" && !references.companyKeys.has(item.objectId)) warnings.push("unknown_company:" + item.objectId);
    if (item.objectType === "industry" && !references.industryIds.has(item.objectId)) warnings.push("unknown_industry:" + item.objectId);
    if (item.objectType === "policy_theme" && !references.policyObjectIds.has(item.objectId)) warnings.push("unknown_policy:" + item.objectId);
    if (item.objectType === "policy_tool" && !references.policyToolIds.has(item.objectId)) warnings.push("unknown_policy_tool:" + item.objectId);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function buildResearchIndex(inputs) {
  const policies = [];
  const industryRelations = [];
  const companyRelations = [];
  const evidence = [];
  const signals = [];
  const risks = [];
  const events = [];
  const policyToolsById = new Map();
  const signalById = new Map();
  const riskById = new Map();
  const eventById = new Map();
  const normalizationReview = [];

  const registerTool = (policyId, label, code = "") => {
    if (!label && !code) return null;
    const toolId = "policy-tool:" + (code || stableId("tool", label).slice(5));
    const existing = policyToolsById.get(toolId) ?? {
      toolId,
      toolKey: code || label,
      labels: [],
      policyIds: []
    };
    existing.labels = unique([...existing.labels, label, code]);
    existing.policyIds = unique([...existing.policyIds, policyId]);
    policyToolsById.set(toolId, existing);
    return toolId;
  };

  const addSignal = (policyId, subjectType, subjectId, description, source, evidenceId = null) => {
    if (!description) return null;
    const signalId = stableId("sig", policyId, subjectType, subjectId, description);
    if (!signalById.has(signalId)) {
      const item = { signalId, policyId, subjectType, subjectId, description, source, evidenceId };
      signalById.set(signalId, item);
      signals.push(item);
    }
    return signalId;
  };

  const addRisk = (policyId, subjectType, subjectId, description, source, evidenceIds = []) => {
    if (!description) return null;
    const riskId = stableId("risk", policyId, subjectType, subjectId, description);
    if (!riskById.has(riskId)) {
      const item = { riskId, policyId, subjectType, subjectId, description, source, evidenceIds };
      riskById.set(riskId, item);
      risks.push(item);
    }
    return riskId;
  };

  const addEvent = (event) => {
    const eventId = event.eventId ?? stableId("evt", event.policyId, event.eventType, event.description);
    const existing = eventById.get(eventId);
    if (existing) {
      existing.relatedIndustries = unique([...existing.relatedIndustries, ...(event.relatedIndustries ?? [])]);
      existing.relatedCompanies = unique([...existing.relatedCompanies, ...(event.relatedCompanies ?? [])]);
      return eventId;
    }
    const item = {
      eventId,
      policyId: event.policyId,
      eventType: event.eventType,
      date: event.date ?? null,
      dateRange: event.dateRange ?? null,
      datePrecision: event.datePrecision ?? "unknown",
      source: event.source,
      evidenceId: event.evidenceId ?? null,
      status: event.status,
      description: event.description,
      relatedIndustries: unique(event.relatedIndustries ?? []),
      relatedCompanies: unique(event.relatedCompanies ?? []),
      uncertainty: event.uncertainty ?? null
    };
    eventById.set(eventId, item);
    events.push(item);
    return eventId;
  };

  for (const entry of inputs.selected) {
    const report = entry.report;
    const policyId = String(report.policyId ?? report.id ?? entry.stablePolicyKey);
    const reportId = String(report.id ?? policyId);
    const title = report.policy?.title ?? report.summary?.title ?? entry.manifest?.title ?? reportId;
    const publishValue = report.policy?.officialPublishedAt ?? report.policy?.publishDateTime ?? report.policy?.publishDate ??
      report.summary?.officialPublishedAt ?? report.summary?.publishDateTime ?? report.summary?.publishDate ?? null;
    const effectiveValue = report.policy?.effectiveDate ?? null;
    const publishDescriptor = structuredDate(publishValue);
    const effectiveDescriptor = structuredDate(effectiveValue);
    const reportVersion = reportVersionLabel(report);
    const nodeById = new Map((report.chainNodes ?? []).map((node) => [node.id, node]));
    const companyById = new Map((report.companies ?? []).map((company) => [company.id, company]));
    const mappingByCompanyId = new Map((report.companyMap ?? []).map((mapping) => [mapping.companyId, mapping]));
    const localEvidenceId = new Map();

    for (const rawEvidence of report.evidence ?? []) {
      const evidenceId = policyId + ":" + String(rawEvidence.id ?? stableId("e", rawEvidence.title, rawEvidence.excerpt));
      localEvidenceId.set(rawEvidence.id, evidenceId);
      evidence.push({
        evidenceId,
        policyId,
        reportId,
        reportPath: entry.reportPath,
        reportVersion,
        evidenceObject: rawEvidence.evidenceObject ?? null,
        type: rawEvidence.type ?? "unknown",
        source: rawEvidence.source ?? report.policy?.source ?? report.summary?.source ?? "",
        sourceUrl: rawEvidence.sourceUrl ?? rawEvidence.url ?? report.policy?.sourceUrl ?? "",
        sourceLocation: rawEvidence.sourceLocation ?? "",
        title: rawEvidence.title ?? "",
        date: rawEvidence.date ?? null,
        excerpt: rawEvidence.excerpt ?? "",
        interpretation: rawEvidence.interpretation ?? "",
        localClauseIds: unique(rawEvidence.clauseIds ?? rawEvidence.links?.clauseIds ?? []),
        localNodeIds: unique(rawEvidence.nodeIds ?? rawEvidence.links?.nodeIds ?? []),
        localCompanyIds: unique(rawEvidence.companyIds ?? rawEvidence.links?.companyIds ?? []),
        relatedIndustryRelationIds: [],
        relatedCompanyRelationIds: []
      });
    }

    const toolIds = unique([
      registerTool(policyId, report.primaryActionType ?? "", entry.manifest?.policyTool ?? ""),
      ...(report.actions ?? []).map((action) => registerTool(policyId, action.actionType ?? action.title ?? ""))
    ]);
    const policyIndustryRelationIds = [];
    for (const relation of report.policyIndustryMap ?? []) {
      const relationId = policyId + ":industry:" + String(relation.id ?? stableId("i", relation.industry, relation.policyAction));
      const normalizedIndustry = normalizeIndustryName(relation.industry, inputs.aliases);
      if (normalizedIndustry.status === "conflict") {
        normalizationReview.push({
          reviewType: "industry_alias_conflict",
          relationId,
          policyId,
          originalName: relation.industry,
          candidates: normalizedIndustry.candidates,
          matchedAliases: normalizedIndustry.matchedAliases
        });
      }
      const relatedNodeIds = unique(relation.relatedNodeIds ?? []);
      const relatedNodes = relatedNodeIds.map((id) => nodeById.get(id)?.title ?? id);
      const relationEvidenceIds = unique((relation.evidenceIds ?? []).map((id) => localEvidenceId.get(id)).filter(Boolean));
      const riskIds = asArray(relation.constraints).map((item) =>
        addRisk(policyId, "industry_relation", relationId, item, entry.reportPath, relationEvidenceIds)
      ).filter(Boolean);
      const signalIds = asArray(relation.watchSignals).map((item) =>
        addSignal(policyId, "industry_relation", relationId, item, entry.reportPath)
      ).filter(Boolean);
      industryRelations.push({
        relationId,
        policyId,
        policyTitle: title,
        policyPublishDate: publishDescriptor.date,
        reportPath: entry.reportPath,
        reportVersion,
        originalIndustry: relation.industry,
        canonicalIndustry: normalizedIndustry.canonicalName,
        normalizationStatus: normalizedIndustry.status,
        matchedAliases: normalizedIndustry.matchedAliases,
        policyAction: relation.policyAction ?? "",
        impactType: relation.impactType ?? "",
        impactDirection: relation.impactDirection ?? relation.policyDirection ?? "",
        impactStrength: relation.impactStrength ?? "",
        evidenceLevel: relation.evidenceLevel ?? "",
        policyCloseness: relation.policyCloseness ?? "",
        reason: relation.reason ?? relation.transmissionPath ?? "",
        relatedNodeIds,
        relatedNodes,
        evidenceIds: relationEvidenceIds,
        signalIds,
        riskIds,
        watchSignals: unique(relation.watchSignals ?? []),
        policyTools: toolIds
      });
      policyIndustryRelationIds.push(relationId);
    }

    const policyCompanyRelationIds = [];
    for (const company of report.companies ?? []) {
      const mapping = mappingByCompanyId.get(company.id) ?? {};
      const companyKey = normalizeCompanyKey(company);
      const relationId = policyId + ":company:" + String(company.id ?? stableId("c", company.name, company.ticker));
      const evidenceIds = unique([
        ...(company.evidenceIds ?? []).map((id) => localEvidenceId.get(id)).filter(Boolean),
        ...(report.evidence ?? [])
          .filter((item) => asArray(item.companyIds ?? item.links?.companyIds).includes(company.id))
          .map((item) => localEvidenceId.get(item.id))
          .filter(Boolean)
      ]);
      const rawRisks = unique([
        ...asArray(mapping.keyRisks),
        ...asArray(mapping.doNotOverread),
        ...asArray(company.riskFactors),
        company.riskNote,
        company.uncertainty
      ]);
      const riskIds = rawRisks.map((item) =>
        addRisk(policyId, "company_relation", relationId, item, entry.reportPath, evidenceIds)
      ).filter(Boolean);
      const rawSignals = unique([
        ...asArray(mapping.watchSignals),
        ...asArray(company.verificationSignals),
        company.implementationDependency
      ]);
      const signalIds = rawSignals.map((item) =>
        addSignal(policyId, "company_relation", relationId, item, entry.reportPath, evidenceIds[0] ?? null)
      ).filter(Boolean);
      const nodeIds = unique(company.nodeIds ?? [mapping.chainNodeId].filter(Boolean));
      const relatedNodes = nodeIds.map((id) => nodeById.get(id)?.title ?? mapping.chainNode ?? id);
      const relationship = normalizeRelationLevel(company, mapping);
      if (!RELATION_LEVELS.includes(relationship)) {
        normalizationReview.push({
          reviewType: "company_relation_level",
          relationId,
          policyId,
          rawValue: mapping.relationship ?? company.mappingLevel ?? company.relation
        });
      }
      companyRelations.push({
        relationId,
        companyKey,
        companyName: company.name,
        ticker: company.ticker ?? mapping.ticker ?? "",
        listingStatus: company.listingStatus ?? (/未上市|非上市/.test(String(company.ticker ?? "")) ? "non_listed" : "listed_or_unspecified"),
        policyId,
        policyTitle: title,
        policyPublishDate: publishDescriptor.date,
        policyTools: toolIds,
        reportPath: entry.reportPath,
        reportVersion,
        relationship,
        rawRelationship: mapping.relationship ?? company.mappingLevel ?? company.relation ?? "",
        officialMention: Boolean(company.officialMention),
        policyEvidenceStrength: mapping.policyEvidence ?? company.evidenceLevel ?? "",
        businessEvidenceStrength: company.companyMappingEvidenceLevel ?? company.evidenceLevel ?? "",
        businessExposure: mapping.businessExposure ?? company.reason ?? company.opportunity ?? "",
        investmentUse: mapping.investmentUse ?? "",
        relatedNodeIds: nodeIds,
        relatedNodes,
        riskIds,
        signalIds,
        risks: rawRisks,
        watchSignals: rawSignals,
        evidenceIds,
        evidenceSources: evidence
          .filter((item) => evidenceIds.includes(item.evidenceId))
          .map((item) => ({
            evidenceId: item.evidenceId,
            type: item.type,
            source: item.source,
            sourceUrl: item.sourceUrl,
            sourceLocation: item.sourceLocation
          }))
      });
      policyCompanyRelationIds.push(relationId);
    }

    for (const item of evidence.filter((item) => item.policyId === policyId)) {
      item.relatedIndustryRelationIds = industryRelations
        .filter((relation) => relation.policyId === policyId && relation.relatedNodeIds.some((id) => item.localNodeIds.includes(id)))
        .map((relation) => relation.relationId);
      item.relatedCompanyRelationIds = companyRelations
        .filter((relation) =>
          relation.policyId === policyId &&
          (item.localCompanyIds.some((id) => relation.relationId.endsWith(":" + id)) ||
            relation.relatedNodeIds.some((id) => item.localNodeIds.includes(id)))
        )
        .map((relation) => relation.relationId);
    }

    const policyRiskDescriptions = unique([
      ...asArray(report.investmentDirection?.keyRisks),
      ...asArray(report.investmentDirection?.doNotOverread),
      ...asArray(report.analysisCoverage?.limitations),
      ...asArray(report.compareInsights?.limitations)
    ]);
    const policyRiskIds = policyRiskDescriptions.map((item) =>
      addRisk(policyId, "policy", policyId, item, entry.reportPath)
    ).filter(Boolean);
    const policySignalDescriptions = unique([
      ...asArray(report.followUpSignals),
      ...asArray(report.investmentDirection?.nearTermCatalysts),
      ...asArray(report.investmentDirection?.minimumEvidenceNeeded),
      ...(report.policyNetwork ?? []).flatMap((item) => asArray(item.watchSignals))
    ]);
    const policySignalIds = policySignalDescriptions.map((item) =>
      addSignal(policyId, "policy", policyId, item, entry.reportPath)
    ).filter(Boolean);
    const relatedCanonicalIndustries = unique(
      industryRelations.filter((item) => item.policyId === policyId).map((item) => item.canonicalIndustry)
    );
    const relatedCompanyKeys = unique(
      companyRelations.filter((item) => item.policyId === policyId).map((item) => item.companyKey)
    );
    const eventIds = [];
    if (publishDescriptor.date || publishDescriptor.dateRange) {
      eventIds.push(addEvent({
        policyId,
        eventType: "policy_publication",
        ...publishDescriptor,
        source: entry.reportPath,
        status: "observed",
        description: "政策发布：" + title,
        relatedIndustries: relatedCanonicalIndustries,
        relatedCompanies: relatedCompanyKeys
      }));
    }
    if (effectiveDescriptor.date || effectiveDescriptor.dateRange) {
      eventIds.push(addEvent({
        policyId,
        eventType: "policy_effective",
        ...effectiveDescriptor,
        source: entry.reportPath,
        status: "in_effect",
        description: "政策施行：" + title,
        relatedIndustries: relatedCanonicalIndustries,
        relatedCompanies: relatedCompanyKeys
      }));
    }
    for (const description of policySignalDescriptions) {
      const descriptor = structuredDate(description);
      eventIds.push(addEvent({
        policyId,
        eventType: classifyEventType(description),
        ...descriptor,
        source: entry.reportPath,
        status: "awaiting_evidence",
        description,
        relatedIndustries: relatedCanonicalIndustries,
        relatedCompanies: relatedCompanyKeys
      }));
    }

    policies.push({
      policyId,
      reportId,
      title,
      issuer: report.policy?.issuer ?? report.summary?.issuer ?? "",
      source: report.policy?.source ?? report.summary?.source ?? "",
      sourceUrl: report.policy?.canonicalSourceUrl ?? report.policy?.sourceUrl ?? entry.manifest?.sourceUrl ?? "",
      publishDate: publishDescriptor.date,
      publishDatePrecision: publishDescriptor.datePrecision,
      effectiveDate: effectiveDescriptor.date,
      status: report.policy?.status ?? report.summary?.status ?? "",
      category: report.policy?.category ?? report.summary?.category ?? "",
      primaryActionType: report.primaryActionType ?? "",
      policySignalStrength: report.policySignalStrength ?? "",
      implementationCertainty: report.implementationCertainty ?? "",
      analysisDepth: report.analysisDepth ?? "",
      judgement: report.brief?.judgement ?? report.brief?.summary ?? "",
      reportPath: entry.reportPath,
      reportSource: entry.reportSource,
      reportVersion,
      generatedAt: report.generatedAt ?? null,
      reportContentHash: entry.sourceContentHash,
      stage9Metadata: entry.manifest ? {
        policyKey: entry.manifest.policyKey,
        policyTool: entry.manifest.policyTool,
        reportDepth: entry.manifest.reportDepth,
        reportOrigin: entry.manifest.reportOrigin,
        validationStatus: entry.manifest.validationStatus
      } : null,
      policyToolIds: toolIds,
      industryRelationIds: policyIndustryRelationIds,
      companyRelationIds: policyCompanyRelationIds,
      evidenceIds: evidence.filter((item) => item.policyId === policyId).map((item) => item.evidenceId),
      signalIds: policySignalIds,
      riskIds: policyRiskIds,
      eventIds: unique(eventIds)
    });
  }

  const policyById = new Map(policies.map((item) => [item.policyId, item]));
  const companyGroups = new Map();
  for (const relation of companyRelations) {
    companyGroups.set(relation.companyKey, [...(companyGroups.get(relation.companyKey) ?? []), relation]);
  }
  const companies = [...companyGroups.entries()].map(([companyKey, relations]) => {
    relations.sort((left, right) =>
      String(right.policyPublishDate ?? "").localeCompare(String(left.policyPublishDate ?? "")) ||
      left.policyTitle.localeCompare(right.policyTitle)
    );
    const aliases = unique(relations.map((item) => item.companyName));
    const ticker = relations.find((item) => item.ticker)?.ticker ?? "";
    return {
      companyKey,
      companyName: aliases.sort((left, right) => left.length - right.length)[0],
      aliases,
      ticker,
      listingStatus: relations.find((item) => item.listingStatus)?.listingStatus ?? "unspecified",
      policyCoverageCount: unique(relations.map((item) => item.policyId)).length,
      policyIds: unique(relations.map((item) => item.policyId)),
      relationships: relations,
      relationEventIds: [],
      disclaimer: DISCLAIMER
    };
  });

  const industryGroups = new Map();
  for (const relation of industryRelations) {
    industryGroups.set(relation.canonicalIndustry, [...(industryGroups.get(relation.canonicalIndustry) ?? []), relation]);
  }
  const industries = [...industryGroups.entries()].map(([canonicalName, relations]) => {
    const relatedCompanies = companyRelations.filter((companyRelation) =>
      relations.some((industryRelation) =>
        industryRelation.policyId === companyRelation.policyId &&
        industryRelation.relatedNodeIds.some((nodeId) => companyRelation.relatedNodeIds.includes(nodeId))
      )
    );
    const verifiedCompanies = unique(
      relatedCompanies
        .filter((item) =>
          ["policy_named", "direct_industry"].includes(item.relationship) &&
          !["pending", ""].includes(normalizeResearchText(item.businessEvidenceStrength))
        )
        .map((item) => item.companyKey)
    );
    const pendingCompanies = unique(
      relatedCompanies
        .filter((item) => !verifiedCompanies.includes(item.companyKey))
        .map((item) => item.companyKey)
    );
    const directionCounts = {};
    for (const relation of relations) {
      const direction = relation.impactDirection || "unspecified";
      directionCounts[direction] = (directionCounts[direction] ?? 0) + 1;
    }
    const policyIds = unique(relations.map((item) => item.policyId));
    const industryId = "industry:" + canonicalName;
    const configured = (inputs.aliases.aliases ?? []).find((item) => item.canonicalName === canonicalName);
    return {
      industryId,
      canonicalName,
      originalNames: unique(relations.map((item) => item.originalIndustry)).sort(),
      configuredAliases: unique(configured?.aliases ?? []),
      policyCount: policyIds.length,
      policyIds,
      policies: policyIds.map((policyId) => ({
        policyId,
        title: policyById.get(policyId)?.title ?? "",
        publishDate: policyById.get(policyId)?.publishDate ?? null,
        policyTools: policyById.get(policyId)?.policyToolIds ?? []
      })).sort((left, right) =>
        String(right.publishDate ?? "").localeCompare(String(left.publishDate ?? "")) ||
        left.policyId.localeCompare(right.policyId)
      ),
      policyToolIds: unique(relations.flatMap((item) => item.policyTools)),
      directionCounts,
      directRelationCount: relations.filter((item) => item.policyCloseness === "direct").length,
      indirectRelationCount: relations.filter((item) => item.policyCloseness !== "direct").length,
      continuity: continuityAssessment(relations),
      companyTypes: unique(relatedCompanies.flatMap((item) => item.relatedNodes)),
      verifiedCompanyKeys: verifiedCompanies,
      pendingCompanyKeys: pendingCompanies,
      realizationConditions: unique(relations.flatMap((item) => item.watchSignals)),
      counterEvidence: unique(
        relatedCompanies.flatMap((item) => item.risks)
          .concat(risks.filter((item) => item.subjectType === "policy" && policyIds.includes(item.policyId)).map((item) => item.description))
      ),
      relationIds: relations.map((item) => item.relationId),
      eventIds: events
        .filter((event) => event.relatedIndustries.includes(canonicalName))
        .map((event) => event.eventId),
      disclaimer: DISCLAIMER
    };
  });

  const policyTools = [...policyToolsById.values()].map((item) => ({
    ...item,
    policyCount: item.policyIds.length,
    policies: item.policyIds.map((policyId) => ({
      policyId,
      title: policyById.get(policyId)?.title ?? "",
      publishDate: policyById.get(policyId)?.publishDate ?? null
    }))
  }));
  const relationEventResult = validateRelationEvents(inputs.relationEvents, companyRelations, evidence, policies);
  for (const company of companies) {
    company.relationEventIds = relationEventResult.events
      .filter((event) => event.companyKey === company.companyKey)
      .map((event) => event.eventId);
  }
  const watchValidation = validateWatchlist(inputs.watchlist, {
    companyKeys: new Set(companies.map((item) => item.companyKey)),
    industryIds: new Set(industries.map((item) => item.industryId)),
    policyObjectIds: new Set(policies.map((item) => "policy:" + item.policyId)),
    policyToolIds: new Set(policyTools.map((item) => item.toolId))
  });

  policies.sort((left, right) =>
    String(right.publishDate ?? "").localeCompare(String(left.publishDate ?? "")) ||
    left.policyId.localeCompare(right.policyId)
  );
  industryRelations.sort((left, right) => left.canonicalIndustry.localeCompare(right.canonicalIndustry, "zh-CN") || left.relationId.localeCompare(right.relationId));
  companyRelations.sort((left, right) => left.companyKey.localeCompare(right.companyKey) || left.relationId.localeCompare(right.relationId));
  companies.sort((left, right) => left.companyName.localeCompare(right.companyName, "zh-CN"));
  industries.sort((left, right) => left.canonicalName.localeCompare(right.canonicalName, "zh-CN"));
  evidence.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  signals.sort((left, right) => left.signalId.localeCompare(right.signalId));
  risks.sort((left, right) => left.riskId.localeCompare(right.riskId));
  events.sort((left, right) => eventSortKey(left).localeCompare(eventSortKey(right)) || left.eventId.localeCompare(right.eventId));
  policyTools.sort((left, right) => left.toolId.localeCompare(right.toolId));

  const fingerprintParts = [
    ...inputs.selected.map((entry) => entry.reportPath + ":" + entry.sourceContentHash),
    "aliases:" + contentHash(inputs.aliases),
    "relation-events:" + contentHash(inputs.relationEvents),
    "watchlist:" + contentHash(inputs.watchlist)
  ].sort();
  const maxReportGeneratedAt = inputs.selected
    .map((entry) => entry.report.generatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    schemaVersion: RESEARCH_INDEX_SCHEMA_VERSION,
    sourceFingerprint: contentHash(fingerprintParts.join("\n")),
    generatedFrom: {
      maxReportGeneratedAt,
      manualReportDirectory: inputs.paths.manualReports,
      extraReportDirectories: inputs.paths.extraReports,
      stage9ManifestPath: inputs.paths.stage9Manifest,
      aliasDictionaryPath: inputs.paths.aliases,
      relationEventsPath: inputs.paths.relationEvents,
      watchlistPath: inputs.paths.watchlist,
      candidateReportCount: inputs.candidates.length,
      selectedReportCount: inputs.selected.length,
      manifestPolicyReferenceCount: inputs.manifest?.policies?.length ?? 0,
      deduplication: inputs.deduplication
    },
    disclaimers: [
      DISCLAIMER,
      "多政策出现次数只是一项检索事实，不是统一推荐分数。",
      "不确定日期保留为 null、年份或日期范围，不补造精确日期。"
    ],
    summary: {
      reportCount: inputs.selected.length,
      policyCount: policies.length,
      industryCount: industries.length,
      industryRelationCount: industryRelations.length,
      companyCount: companies.length,
      companyRelationCount: companyRelations.length,
      evidenceCount: evidence.length,
      policyToolCount: policyTools.length,
      eventCount: events.length,
      signalCount: signals.length,
      riskCount: risks.length,
      relationEventCount: relationEventResult.events.length,
      watchObjectCount: inputs.watchlist.objects?.length ?? 0,
      normalizationConflictCount: normalizationReview.length
    },
    policies,
    industries,
    industryRelations,
    companies,
    companyRelations,
    evidence,
    policyTools,
    events,
    signals,
    risks,
    relationEvents: {
      schemaVersion: inputs.relationEvents.schemaVersion,
      allowedChangeTypes: inputs.relationEvents.allowedChangeTypes,
      ...relationEventResult
    },
    watchlist: {
      schemaVersion: inputs.watchlist.schemaVersion,
      capacity: inputs.watchlist.capacity,
      allowedStatuses: inputs.watchlist.allowedStatuses,
      objects: inputs.watchlist.objects,
      validation: watchValidation
    },
    normalizationReview
  };
}

export async function buildResearchIndexFromDisk(root = process.cwd(), overrides = {}) {
  return buildResearchIndex(await loadResearchInputs(root, overrides));
}

export async function writeResearchIndex(root = process.cwd(), outputPath = DEFAULT_RESEARCH_INDEX_PATH, overrides = {}) {
  const index = await buildResearchIndexFromDisk(root, overrides);
  const absoluteOutput = path.resolve(root, outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  await fs.writeFile(absoluteOutput, JSON.stringify(index, null, 2) + "\n", "utf8");
  return { index, outputPath: normalizePath(path.relative(root, absoluteOutput)) };
}

export async function loadBuiltResearchIndex(root = process.cwd(), indexPath = DEFAULT_RESEARCH_INDEX_PATH) {
  return readJson(path.resolve(root, indexPath));
}

function fuzzyMatch(query, values) {
  if (!query) return true;
  return values.flat(Infinity).some((value) => {
    const normalized = normalizeResearchText(value);
    return normalized.includes(query) || (normalized.length >= 4 && query.includes(normalized));
  });
}

export function queryResearchIndex(index, type, input = "") {
  const query = normalizeResearchText(input);
  let results;
  const normalizationHints = [];
  if (type === "summary") {
    return {
      query: { type, input, normalized: query },
      count: index.summary.policyCount,
      summary: index.summary,
      results: index.policies,
      normalizationHints,
      disclaimer: DISCLAIMER
    };
  }
  if (type === "company") {
    results = index.companies.filter((item) => fuzzyMatch(query, [item.companyName, item.aliases, item.ticker, item.companyKey]));
  } else if (type === "industry") {
    results = index.industries.filter((item) => fuzzyMatch(query, [
      item.canonicalName,
      item.originalNames,
      item.configuredAliases
    ]));
    for (const item of results) {
      if (input && normalizeResearchText(item.canonicalName) !== query) {
        normalizationHints.push(input + " -> " + item.canonicalName);
      }
    }
  } else if (type === "policy") {
    results = index.policies.filter((item) => fuzzyMatch(query, [
      item.policyId,
      item.title,
      item.issuer,
      item.category,
      item.primaryActionType,
      item.judgement
    ]));
  } else if (type === "policy-tool") {
    results = index.policyTools.filter((item) => fuzzyMatch(query, [item.toolId, item.toolKey, item.labels]));
  } else if (type === "evidence") {
    results = index.evidence.filter((item) => fuzzyMatch(query, [
      item.evidenceId,
      item.title,
      item.source,
      item.sourceLocation,
      item.excerpt
    ]));
  } else if (type === "relation" || type === "relation-event") {
    results = index.relationEvents.events.filter((item) => fuzzyMatch(query, [
      item.eventId,
      item.companyName,
      item.ticker,
      item.policyTitle,
      item.reason,
      item.changeType
    ]));
  } else {
    throw new Error("Query type must be summary, company, industry, policy, policy-tool, evidence, or relation.");
  }
  return {
    query: { type, input, normalized: query },
    count: results.length,
    results,
    normalizationHints: unique(normalizationHints),
    disclaimer: DISCLAIMER
  };
}

export function queryResearchTimeline(index, filterType = "all", input = "") {
  let policyIds = null;
  let companyKeys = null;
  let industryNames = null;
  let events = index.events;
  if (filterType === "industry") {
    const industries = queryResearchIndex(index, "industry", input).results;
    industryNames = new Set(industries.map((item) => item.canonicalName));
    policyIds = new Set(industries.flatMap((item) => item.policyIds));
    events = events.filter((event) =>
      event.relatedIndustries.some((item) => industryNames.has(item)) ||
      policyIds.has(event.policyId)
    );
  } else if (filterType === "company") {
    const companies = queryResearchIndex(index, "company", input).results;
    companyKeys = new Set(companies.map((item) => item.companyKey));
    policyIds = new Set(companies.flatMap((item) => item.policyIds));
    events = events.filter((event) =>
      event.relatedCompanies.some((item) => companyKeys.has(item)) ||
      policyIds.has(event.policyId)
    );
  } else if (filterType === "policy") {
    policyIds = new Set(queryResearchIndex(index, "policy", input).results.map((item) => item.policyId));
    events = events.filter((event) => policyIds.has(event.policyId));
  } else if (filterType === "policy-tool") {
    policyIds = new Set(queryResearchIndex(index, "policy-tool", input).results.flatMap((item) => item.policyIds));
    events = events.filter((event) => policyIds.has(event.policyId));
  } else if (filterType === "event-type") {
    const query = normalizeResearchText(input);
    events = events.filter((event) => fuzzyMatch(query, [event.eventType, event.description]));
  } else if (filterType !== "all") {
    throw new Error("Timeline filter must be all, industry, company, policy, policy-tool, or event-type.");
  }
  events = [...events].sort((left, right) =>
    eventSortKey(left).localeCompare(eventSortKey(right)) || left.eventId.localeCompare(right.eventId)
  );
  return {
    query: { type: "timeline", filterType, input, normalized: normalizeResearchText(input) },
    count: events.length,
    results: events,
    disclaimer: DISCLAIMER
  };
}

export function validateBuiltResearchIndex(index) {
  const errors = [];
  if (index.schemaVersion !== RESEARCH_INDEX_SCHEMA_VERSION) errors.push("schema_version_mismatch");
  if (index.summary.reportCount !== index.policies.length) errors.push("report_policy_count_mismatch");
  if (new Set(index.policies.map((item) => item.policyId)).size !== index.policies.length) errors.push("duplicate_policy_id");
  if (new Set(index.companyRelations.map((item) => item.relationId)).size !== index.companyRelations.length) errors.push("duplicate_company_relation_id");
  if (new Set(index.industryRelations.map((item) => item.relationId)).size !== index.industryRelations.length) errors.push("duplicate_industry_relation_id");
  if (index.companyRelations.some((item) => !RELATION_LEVELS.includes(item.relationship))) errors.push("invalid_relationship_level");
  if (!index.relationEvents.validation.valid) errors.push(...index.relationEvents.validation.errors);
  if (!index.watchlist.validation.valid) errors.push(...index.watchlist.validation.errors);
  return { valid: errors.length === 0, errors };
}
