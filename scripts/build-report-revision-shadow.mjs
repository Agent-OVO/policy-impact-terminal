#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildShadowPackage } from "./lib/report-revision-core.mjs";

const args = parseArgs(process.argv.slice(2));
const reports = await readReports(args.reportsDir);
const sourceDocuments = args.sourceDocuments
  ? await readSourceDocuments(args.sourceDocuments)
  : [];
const shadowPackage = buildShadowPackage(reports, { sourceDocuments });

if (args.requireSourceDocuments && !shadowPackage.sourceCandidateReady) {
  throw new Error(
    `Shadow package is missing ${shadowPackage.counts.missingSourceDocuments} source document candidate(s).`
  );
}
if (args.requireDeploymentReady && !shadowPackage.deploymentReady) {
  throw new Error(
    `Shadow package is not deployment-ready: verified=${shadowPackage.counts.verifiedSourceDocuments} ` +
    `candidate=${shadowPackage.counts.candidateSourceDocuments} missing=${shadowPackage.counts.missingSourceDocuments}.`
  );
}

await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
await fs.writeFile(path.resolve(args.out), `${JSON.stringify(shadowPackage, null, 2)}\n`, "utf8");

console.log(`[stage7:shadow] reports=${shadowPackage.counts.reports}`);
console.log(`[stage7:shadow] content projections actions=${shadowPackage.counts.policyActions} nodes=${shadowPackage.counts.industryNodes} edges=${shadowPackage.counts.industryEdges}`);
console.log(`[stage7:shadow] companyRelations=${shadowPackage.counts.companyRelations} policyNetwork=${shadowPackage.counts.policyNetworkRelations} evidence=${shadowPackage.counts.evidenceRefs} signals=${shadowPackage.counts.signals}`);
console.log(`[stage7:shadow] sourceDocuments=${shadowPackage.counts.sourceDocuments} verified=${shadowPackage.counts.verifiedSourceDocuments} candidate=${shadowPackage.counts.candidateSourceDocuments} missing=${shadowPackage.counts.missingSourceDocuments} candidateReady=${shadowPackage.sourceCandidateReady} deploymentReady=${shadowPackage.deploymentReady}`);
console.log(`[stage7:shadow] wrote ${path.resolve(args.out)}`);

function parseArgs(argv) {
  const parsed = {
    reportsDir: "manual-reports",
    sourceDocuments: "",
    out: "artifacts/stage7/report-revision-shadow.json",
    requireSourceDocuments: false,
    requireDeploymentReady: false
  };

  for (const arg of argv) {
    if (arg.startsWith("--reports-dir=")) parsed.reportsDir = arg.slice("--reports-dir=".length);
    else if (arg.startsWith("--source-documents=")) parsed.sourceDocuments = arg.slice("--source-documents=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg === "--require-source-documents") parsed.requireSourceDocuments = true;
    else if (arg === "--require-deployment-ready") parsed.requireDeploymentReady = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

async function readReports(directory) {
  const resolved = path.resolve(directory);
  const files = (await fs.readdir(resolved))
    .filter((file) => file.endsWith(".json"))
    .sort();
  return Promise.all(
    files.map(async (file) => JSON.parse(await fs.readFile(path.join(resolved, file), "utf8")))
  );
}

async function readSourceDocuments(filePath) {
  const value = JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.documents)) return value.documents;
  if (Array.isArray(value.policies)) return value.policies;
  throw new Error("Source document export must be an array or contain documents/policies array.");
}

function printHelp() {
  console.log(`
Usage:
  npm run stage7:shadow
  npm run stage7:shadow -- --source-documents=artifacts/stage7/source-documents.json
  npm run stage7:shadow -- --source-documents=artifacts/stage7/source-documents.json --require-source-documents
  npm run stage7:shadow -- --source-documents=artifacts/stage7/source-documents.json --require-deployment-ready

Options:
  --reports-dir=<path>          Reviewed report JSON directory. Default: manual-reports.
  --source-documents=<path>     Optional production source export with policyId/fullText.
  --out=<path>                  Shadow package output. Default: artifacts/stage7/report-revision-shadow.json.
  --require-source-documents    Fail unless every report has a source document candidate.
  --require-deployment-ready    Fail unless every source document is production-exported or cross-checked.
`);
}
