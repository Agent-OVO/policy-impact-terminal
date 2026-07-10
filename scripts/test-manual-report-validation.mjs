#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const root = process.cwd();
const validator = path.join(root, "scripts", "validate-manual-report.mjs");
const reports = {
  legacy: path.join(root, "manual-reports", "4ce9cfc5-f9ca-48bb-a265-3ee7fdc9c39d.json"),
  employment: path.join(root, "manual-reports", "0e80e84c-03f0-4c7f-9bd2-46470000bab1.json"),
  industry: path.join(root, "manual-reports", "eaf74ff3-c21f-4a77-b402-57f8be41f866.json"),
  named: path.join(root, "manual-reports", "2d6943d5-1653-40d9-a148-a98aaf6fca82.json"),
  regulatory: path.join(root, "manual-reports", "ab109913-f9c4-4fa4-bc2b-cf32d80c99bc.json"),
  catalog: path.join(root, "manual-reports", "560837e2-0eaf-4782-8c93-44751864d1a7.json"),
  ethics: path.join(root, "manual-reports", "8ffc886f-0797-4969-9a15-9afd6f3ff960.json"),
  hrAi: path.join(root, "manual-reports", "4e45255c-dc48-4526-8ca3-3f313e68780a.json"),
  waterPrice: path.join(root, "manual-reports", "209014c2-561d-4421-a82b-b9e16f537d3f.json"),
  energyAi: path.join(root, "manual-reports", "8b35e8fa-77e2-4ea8-9b9b-1672d4c162b9.json"),
  beautyAssessment: path.join(root, "manual-reports", "dc6e49f1-e899-431e-be21-6a7bcbfb2f32.json"),
  textileBrand: path.join(root, "manual-reports", "5ed40988-906c-463d-88b5-dd0c70003535.json"),
  beautyPlan: path.join(root, "manual-reports", "3abd8068-084e-441f-b96b-7c849ca324f7.json"),
  emergencyPlan: path.join(root, "manual-reports", "95eae56e-f1d2-4312-8437-b6cab8b7019f.json"),
  agriculturePlan: path.join(root, "manual-reports", "f727075a-ad27-428f-a181-cfa098e891fb.json"),
  carbonPeak: path.join(root, "manual-reports", "b62836d8-c4a0-46ab-981c-804bc356e09d.json"),
  urbanRenewal: path.join(root, "manual-reports", "d18444d2-2ed2-4a2e-a5a0-051168b4bc7b.json"),
  education: path.join(root, "manual-reports", "f5e5831c-ca2b-4565-ae0f-f8ae7e5cfb78.json")
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-report-validation-"));
let failed = false;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeVariant(name, baseFile, mutate) {
  const report = readJson(baseFile);
  mutate(report);
  const file = path.join(tempDir, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return file;
}

function validate(file) {
  return spawnSync(process.execPath, [validator, file], {
    cwd: root,
    env: { ...process.env, MANUAL_QUALITY_STRICT: "true" },
    encoding: "utf8"
  });
}

function runCase(name, file, expectedSuccess) {
  const result = validate(file);
  const succeeded = result.status === 0;
  if (succeeded !== expectedSuccess) {
    failed = true;
    console.error(`[manual:test] fail ${name}: expected ${expectedSuccess ? "success" : "failure"}`);
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
    return;
  }
  console.log(`[manual:test] ok ${name}`);
}

async function testMapperDerivation(compactFile) {
  const bundleFile = path.join(tempDir, "report-mappers.bundle.mjs");
  buildSync({
    entryPoints: [path.join(root, "src", "lib", "reportMappers.ts")],
    outfile: bundleFile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent"
  });

  const { mapPolicyReport } = await import(`${pathToFileURL(bundleFile).href}?test=${Date.now()}`);
  const mapped = mapPolicyReport(readJson(compactFile));
  const sourceNode = mapped.chainNodes.find((item) => item.id === mapped.industryChain[0].nodes[0].id);
  const relationNode = mapped.industryChain[0].nodes[0];
  const relationCompany = mapped.companyMap[0];
  const sourceCompany = mapped.companies.find((item) => item.id === relationCompany.companyId);
  const sourceCompanyNode = mapped.chainNodes.find((item) => item.id === relationCompany.chainNodeId);

  const checks = [
    relationNode.name === sourceNode?.title,
    relationNode.position === sourceNode?.section,
    JSON.stringify(relationNode.companyIds) === JSON.stringify(sourceNode?.companyIds),
    relationCompany.company === sourceCompany?.name,
    relationCompany.ticker === sourceCompany?.ticker,
    relationCompany.chainNode === sourceCompanyNode?.title
  ];

  if (checks.some((value) => !value)) {
    failed = true;
    console.error("[manual:test] fail runtime mapper did not derive compact identity fields");
    return;
  }
  console.log("[manual:test] ok runtime mapper derives compact identity fields");
}

try {
  runCase("valid legacy report", reports.legacy, true);
  runCase("valid employment plan report", reports.employment, true);
  runCase("valid industry-company report", reports.industry, true);
  runCase("valid policy-named report", reports.named, true);
  runCase("valid regulatory report", reports.regulatory, true);
  runCase("valid vehicle catalog report", reports.catalog, true);
  runCase("valid AI ethics pilot report", reports.ethics, true);
  runCase("valid AI plus HR report", reports.hrAi, true);
  runCase("valid South-to-North water price report", reports.waterPrice, true);
  runCase("valid energy AI report", reports.energyAi, true);
  runCase("valid Beautiful China assessment report", reports.beautyAssessment, true);
  runCase("valid textile brand report", reports.textileBrand, true);
  runCase("valid Beautiful China plan report", reports.beautyPlan, true);
  runCase("valid emergency plan report", reports.emergencyPlan, true);
  runCase("valid agriculture plan report", reports.agriculturePlan, true);
  runCase("valid carbon peak report", reports.carbonPeak, true);
  runCase("valid urban renewal report", reports.urbanRenewal, true);
  runCase("valid education plan report", reports.education, true);

  const compact = writeVariant("valid-compact-derived-identities", reports.industry, (report) => {
    for (const chain of report.industryChain ?? []) {
      for (const node of chain.nodes ?? []) {
        delete node.name;
        delete node.position;
        delete node.evidenceLevel;
        delete node.companyIds;
        delete node.watchSignals;
      }
    }
    for (const item of report.companyMap ?? []) {
      delete item.company;
      delete item.ticker;
      delete item.chainNode;
    }
  });
  runCase("valid compact report with derived identities", compact, true);
  await testMapperDerivation(compact);

  const missingNode = writeVariant("invalid-missing-node-reference", reports.industry, (report) => {
    report.companyMap[0].chainNodeId = "missing-node";
  });
  runCase("invalid missing node reference", missingNode, false);

  const missingCompany = writeVariant("invalid-missing-company-reference", reports.industry, (report) => {
    report.companyMap[0].companyId = "missing-company";
  });
  runCase("invalid missing company reference", missingCompany, false);

  const identityConflict = writeVariant("invalid-company-identity-conflict", reports.industry, (report) => {
    report.companyMap[0].company = "错误公司名称";
  });
  runCase("invalid duplicated company identity conflict", identityConflict, false);

  const nodeCompaniesConflict = writeVariant("invalid-node-company-conflict", reports.industry, (report) => {
    report.industryChain[0].nodes[0].companyIds = ["co999"];
  });
  runCase("invalid duplicated node company conflict", nodeCompaniesConflict, false);

  const strongPolicyWithoutSource = writeVariant("invalid-strong-policy-source", reports.industry, (report) => {
    const item = report.policyNetwork.find((entry) => entry.evidenceLevel === "strong");
    delete item.sourceUrl;
  });
  runCase("invalid strong policy relationship without source", strongPolicyWithoutSource, false);

  const misleadingInvestmentLanguage = writeVariant("invalid-investment-language", reports.industry, (report) => {
    report.investmentDirection.summary += " 建议立即买入。";
  });
  runCase("invalid misleading investment language", misleadingInvestmentLanguage, false);

  const regulatoryWithoutRole = writeVariant("invalid-regulatory-role", reports.regulatory, (report) => {
    delete report.companyMap[0].regulatoryRole;
  });
  runCase("invalid regulatory company without role", regulatoryWithoutRole, false);

  const providerWithoutSignal = writeVariant("invalid-provider-signal", reports.regulatory, (report) => {
    const provider = report.companyMap.find((item) => item.regulatoryRole === "compliance_provider");
    provider.watchSignals = [];
  });
  runCase("invalid compliance provider without watch signal", providerWithoutSignal, false);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log("[manual:test] all validation regression cases passed");
