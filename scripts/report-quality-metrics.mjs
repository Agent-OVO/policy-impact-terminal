#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const reportDir = path.join(root, "manual-reports");
const registryFile = path.join(root, "docs", "manual-analysis", "report-governance-registry-v1.0.json");
const jsonOutput = process.argv.includes("--json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

function evidenceObject(item) {
  return string(item?.evidenceObject || item?.evidence_object);
}

function isFullModuleReport(report) {
  return (
    array(report.policyIndustryMap).length > 0 &&
    array(report.industryChain).length > 0 &&
    array(report.policyNetwork).length > 0 &&
    report.investmentDirection &&
    typeof report.investmentDirection === "object"
  );
}

const registry = readJson(registryFile);
const entries = array(registry.reports);
const registryById = new Map();
const errors = [];

for (const entry of entries) {
  const id = string(entry.policyId);
  if (!id) {
    errors.push("registry contains an entry without policyId");
    continue;
  }
  if (registryById.has(id)) errors.push(`registry contains duplicate policyId ${id}`);
  registryById.set(id, entry);
}

const files = fs.readdirSync(reportDir).filter((name) => name.endsWith(".json")).sort();
const reportIds = new Set(files.map((name) => name.replace(/\.json$/, "")));

for (const id of reportIds) {
  if (!registryById.has(id)) errors.push(`report ${id} is not registered`);
}
for (const id of registryById.keys()) {
  if (!reportIds.has(id)) errors.push(`registered report ${id} is missing from manual-reports`);
}

const metrics = {
  generatedAt: new Date().toISOString(),
  totalReports: files.length,
  registeredReports: entries.length,
  categories: { A: 0, B: 0, C: 0 },
  migrationStatus: { full: 0, light: 0 },
  fullModuleReports: 0,
  totalEvidence: 0,
  evidenceWithObject: 0,
  companyMappings: 0,
  companyMappingsWithIndependentEvidence: 0,
  pendingOrWatchMappings: 0,
  reports: []
};

for (const file of files) {
  const id = file.replace(/\.json$/, "");
  const report = readJson(path.join(reportDir, file));
  const entry = registryById.get(id);
  if (!entry) continue;

  if (Object.hasOwn(metrics.categories, entry.category)) metrics.categories[entry.category] += 1;
  else errors.push(`registry category for ${id} must be A, B, or C`);

  if (Object.hasOwn(metrics.migrationStatus, entry.migrationStatus)) metrics.migrationStatus[entry.migrationStatus] += 1;
  else errors.push(`registry migrationStatus for ${id} must be full or light`);

  const fullModules = isFullModuleReport(report);
  if (fullModules) metrics.fullModuleReports += 1;

  const evidence = array(report.evidence);
  const companyMap = array(report.companyMap);
  const independentCompanyIds = new Set(
    evidence
      .filter((item) => evidenceObject(item) === "company_mapping")
      .flatMap((item) => array(item.companyIds || item.company_ids))
      .map(String)
  );

  const supportedMappings = companyMap.filter((item) => independentCompanyIds.has(String(item.companyId || item.company_id))).length;
  const pendingMappings = companyMap.filter((item) => {
    const relationship = string(item.relationship || item.mappingLevel || item.mapping_level).toLowerCase();
    const policyEvidence = string(item.policyEvidence || item.policy_evidence).toLowerCase();
    return ["pending", "watch_only", "thematic_only"].includes(relationship) || ["pending", "watch_only"].includes(policyEvidence);
  }).length;

  metrics.totalEvidence += evidence.length;
  metrics.evidenceWithObject += evidence.filter((item) => evidenceObject(item)).length;
  metrics.companyMappings += companyMap.length;
  metrics.companyMappingsWithIndependentEvidence += supportedMappings;
  metrics.pendingOrWatchMappings += pendingMappings;

  if (entry.migrationStatus === "full") {
    if (!/policy-industry-company-methodology-v1\.0/i.test(string(report.methodologyVersion))) {
      errors.push(`${id} is marked full but does not declare policy-industry-company-methodology-v1.0`);
    }
    if (!fullModules) errors.push(`${id} is marked full but one or more relationship modules are missing`);
    if (evidence.some((item) => !evidenceObject(item))) {
      errors.push(`${id} is marked full but contains evidence without evidenceObject`);
    }
    if (array(report.companies).length > 0 && companyMap.length === 0) {
      errors.push(`${id} is marked full, has companies, but companyMap is empty`);
    }
  }

  metrics.reports.push({
    policyId: id,
    category: entry.category,
    migrationStatus: entry.migrationStatus,
    methodologyVersion: string(report.methodologyVersion) || "legacy",
    fullModules,
    evidenceCount: evidence.length,
    evidenceObjectCoverage: evidence.length ? Number((evidence.filter((item) => evidenceObject(item)).length / evidence.length).toFixed(3)) : 1,
    companyMapCount: companyMap.length,
    independentCompanyEvidenceCount: independentCompanyIds.size,
    supportedCompanyMapCount: supportedMappings,
    pendingOrWatchCount: pendingMappings
  });
}

metrics.evidenceObjectCoverage = metrics.totalEvidence
  ? Number((metrics.evidenceWithObject / metrics.totalEvidence).toFixed(3))
  : 1;
metrics.independentCompanyEvidenceCoverage = metrics.companyMappings
  ? Number((metrics.companyMappingsWithIndependentEvidence / metrics.companyMappings).toFixed(3))
  : 1;

if (metrics.totalReports !== metrics.registeredReports) {
  errors.push(`report count ${metrics.totalReports} does not match registry count ${metrics.registeredReports}`);
}
if (metrics.fullModuleReports !== metrics.migrationStatus.full) {
  errors.push(`full module report count ${metrics.fullModuleReports} does not match registry full count ${metrics.migrationStatus.full}`);
}

if (jsonOutput) {
  console.log(JSON.stringify({ ok: errors.length === 0, metrics, errors }, null, 2));
} else {
  console.log(`[manual:metrics] reports=${metrics.totalReports} full=${metrics.migrationStatus.full} light=${metrics.migrationStatus.light}`);
  console.log(`[manual:metrics] categories A=${metrics.categories.A} B=${metrics.categories.B} C=${metrics.categories.C}`);
  console.log(`[manual:metrics] evidence=${metrics.totalEvidence} objectCoverage=${metrics.evidenceObjectCoverage}`);
  console.log(`[manual:metrics] companyMap=${metrics.companyMappings} independentlySupported=${metrics.companyMappingsWithIndependentEvidence} coverage=${metrics.independentCompanyEvidenceCoverage}`);
  console.log(`[manual:metrics] pendingOrWatchMappings=${metrics.pendingOrWatchMappings}`);
  if (errors.length) {
    for (const error of errors) console.error(`[manual:metrics] error: ${error}`);
  }
}

if (errors.length) process.exit(1);
