#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeSourceText, sha256Text } from "./lib/report-revision-core.mjs";

const args = parseArgs(process.argv.slice(2));
const official = JSON.parse(await fs.readFile(path.resolve(args.official), "utf8"));
const production = JSON.parse(await fs.readFile(path.resolve(args.production), "utf8"));
const officialById = new Map((official.documents ?? []).map((item) => [String(item.policyId), item]));
const productionById = new Map((production.documents ?? []).map((item) => [String(item.policyId), item]));
const policyIds = [...new Set([...officialById.keys(), ...productionById.keys()])].sort();

const rows = policyIds.map((policyId) => compareDocument(
  policyId,
  officialById.get(policyId),
  productionById.get(policyId)
));
const counts = rows.reduce((result, row) => {
  result[row.status] = (result[row.status] ?? 0) + 1;
  return result;
}, {});
const output = {
  formatVersion: "stage7-source-crosscheck-v1",
  generatedAt: new Date().toISOString(),
  counts: { total: rows.length, ...counts },
  rows
};

await writeJson(args.out, output);
console.log(`[stage7:source-crosscheck] total=${rows.length} ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(" ")}`);
console.log(`[stage7:source-crosscheck] wrote ${path.resolve(args.out)}`);
if (args.failOnDivergence && rows.some((item) => ["missing_official", "missing_production", "divergent"].includes(item.status))) {
  throw new Error("Source crosscheck contains missing or divergent rows.");
}

function compareDocument(policyId, officialDocument, productionDocument) {
  const officialText = normalizeSourceText(officialDocument?.fullText ?? officialDocument?.normalizedText ?? "");
  const productionText = normalizeSourceText(productionDocument?.fullText ?? productionDocument?.normalizedText ?? "");
  const officialHash = officialText ? sha256Text(officialText) : null;
  const productionHash = productionText ? sha256Text(productionText) : null;
  if (!officialText) return base("missing_official");
  if (!productionText) return base("missing_production");
  if (officialHash === productionHash) return base("exact");

  const officialCompact = compact(officialText);
  const productionCompact = compact(productionText);
  const productionInOfficial = officialCompact.includes(productionCompact);
  const officialInProduction = productionCompact.includes(officialCompact);
  const productionRecall = ngramRecall(productionCompact, officialCompact, 8);
  const officialRecall = ngramRecall(officialCompact, productionCompact, 8);
  let status = "divergent";
  if (productionInOfficial || productionRecall >= 0.9) status = "production_subset_of_official";
  else if (officialInProduction || officialRecall >= 0.9) status = "official_subset_of_production";
  else if (Math.max(productionRecall, officialRecall) >= 0.65) status = "materially_overlapping";

  return base(status, {
    productionRecallInOfficial: round(productionRecall),
    officialRecallInProduction: round(officialRecall)
  });

  function base(statusValue, extra = {}) {
    return {
      policyId,
      status: statusValue,
      officialHash,
      productionHash,
      officialLength: officialText.length,
      productionLength: productionText.length,
      lengthRatio: officialText.length && productionText.length
        ? round(productionText.length / officialText.length)
        : null,
      officialVerificationStatus: officialDocument?.metadata?.verificationStatus ?? officialDocument?.verificationStatus ?? null,
      productionVerificationStatus: productionDocument?.metadata?.verificationStatus ?? productionDocument?.verificationStatus ?? null,
      ...extra
    };
  }
}

function ngramRecall(subject, reference, size) {
  if (!subject || subject.length < size || !reference) return 0;
  const referenceSet = new Set();
  for (let index = 0; index <= reference.length - size; index += 1) {
    referenceSet.add(reference.slice(index, index + size));
  }
  let total = 0;
  let matched = 0;
  for (let index = 0; index <= subject.length - size; index += 1) {
    total += 1;
    if (referenceSet.has(subject.slice(index, index + size))) matched += 1;
  }
  return total ? matched / total : 0;
}

function compact(value) {
  return normalizeSourceText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function round(value) {
  return Number(value.toFixed(4));
}

function parseArgs(argv) {
  const parsed = {
    official: "artifacts/stage7/official-source-documents.json",
    production: "artifacts/stage7/production-source-documents.json",
    out: "artifacts/stage7/source-crosscheck.json",
    failOnDivergence: false
  };
  for (const arg of argv) {
    if (arg.startsWith("--official=")) parsed.official = arg.slice("--official=".length);
    else if (arg.startsWith("--production=")) parsed.production = arg.slice("--production=".length);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg === "--fail-on-divergence") parsed.failOnDivergence = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
