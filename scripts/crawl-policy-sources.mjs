#!/usr/bin/env node
import * as cheerio from "cheerio";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  attachPolicyTriage,
  buildLimitedPolicyPlan
} from "./lib/policy-triage.mjs";
import { hydratePolicyAttachments } from "./lib/policy-attachments.mjs";

const CRAWLER_VERSION = "policy-source-crawler-v0.3";
const MIN_POLICY_FULL_TEXT_LENGTH = 280;
const DEFAULT_POLICY_SINCE = "2026-05-01";
const DEFAULT_SOURCE_SCAN_LIMIT = 60;
const DEFAULT_CANDIDATE_LIMIT = 24;
const DEFAULT_INGEST_LIMIT = 24;
const DEFAULT_ANALYSIS_PER_RUN_LIMIT = 3;
const DEFAULT_PENDING_QUEUE_LIMIT = 8;

const SOURCES = [
  {
    key: "gov_zhengce_latest",
    name: "中国政府网 - 最新政策",
    issuer: "中国政府网",
    priority: 80,
    listUrl: "https://www.gov.cn/zhengce/zuixin/",
    fetch: fetchGovLatest
  },
  {
    key: "ndrc_policy_documents",
    name: "国家发展改革委 - 政策文件库",
    issuer: "国家发展改革委",
    priority: 90,
    listUrl: "https://www.ndrc.gov.cn/xxgk/wjk/",
    fetch: fetchNdrcDocuments
  },
  {
    key: "miit_policy_library",
    name: "工业和信息化部 - 政策文件库",
    issuer: "工业和信息化部",
    priority: 90,
    listUrl: "https://www.miit.gov.cn/search/zcwjk.html?websiteid=110000000000000&pg=&p=&tpl=14&category=183&q=",
    fetch: fetchMiitDocuments
  },
  {
    key: "nda_policy_release",
    name: "国家数据局 - 政策发布",
    issuer: "国家数据局",
    priority: 88,
    listUrl: "https://www.nda.gov.cn/sjj/zwgk/zcfb/list/index_pc_1.html",
    fetch: fetchNdaPolicyRelease
  }
];

const args = parseArgs(process.argv.slice(2));
await loadEnvFiles([".env.local", ".env"]);

if (args.preflight) {
  await preflightSupabaseFunctions();
  process.exit(0);
}

const selectedSources = selectSources(args.source);
const crawledAt = new Date().toISOString();
const collected = [];
const errors = [];
const sourceHealth = [];

if (args.autoPublishRequested) {
  throw new Error("--auto-publish is disabled. The crawler only ingests original policy text; reviewed manual analysis must publish reports.");
}

for (const source of selectedSources) {
  try {
    const fetched = await source.fetch(source, args);
    const items = fetched.slice(0, args.sourceScanLimit);
    collected.push(...items);
    sourceHealth.push({ sourceKey: source.key, sourceName: source.name, status: "ok", listCandidates: items.length, error: null });
    console.log(`[crawl] ${source.key}: ${items.length} candidates`);
  } catch (error) {
    const message = getErrorMessage(error);
    errors.push({ sourceKey: source.key, message });
    sourceHealth.push({ sourceKey: source.key, sourceName: source.name, status: "failed", listCandidates: 0, error: message });
    console.error(`[crawl] ${source.key}: ${message}`);
  }
}

const filtered = collected
  .filter((item) => args.includeInterpretations || !isNonPolicyDocument(item))
  .filter((item) => !args.since || (item.publishDate ? item.publishDate >= args.since : !args.excludeUndated));

const initialDedupe = dedupeCandidates(filtered);
const preliminaryPlan = buildLimitedPolicyPlan(
  initialDedupe.candidates.map((item) => attachPolicyTriage(item)),
  {
    candidateLimit: args.candidateLimit,
    ingestLimit: args.ingestLimit,
    analysisPerRunLimit: args.analysisPerRunLimit,
    pendingQueueLimit: args.pendingQueueLimit,
    automaticAnalysisSelection: args.autoSelectAnalysis,
    hasUsableFullText: () => true
  }
);
const hydrated = await hydrateCandidates(preliminaryPlan.candidatePool);
const hydratedDedupe = dedupeCandidates(hydrated);
const plan = buildLimitedPolicyPlan(
  hydratedDedupe.candidates.map((item) => attachPolicyTriage(item)),
  {
    candidateLimit: args.candidateLimit,
    ingestLimit: args.ingestLimit,
    analysisPerRunLimit: args.analysisPerRunLimit,
    pendingQueueLimit: args.pendingQueueLimit,
    automaticAnalysisSelection: args.autoSelectAnalysis,
    hasUsableFullText
  }
);
const duplicates = [...initialDedupe.duplicates, ...hydratedDedupe.duplicates];
const finalizedSourceHealth = finalizeSourceHealth(sourceHealth, filtered, hydrated);
const extractionFailure = finalizedSourceHealth.some((item) => item.status === "failed" && item.hydratedCandidates > 0);
const runStatus = extractionFailure ? "failed" : errors.length > 0 ? "degraded" : "ok";
const output = {
  crawlerVersion: CRAWLER_VERSION,
  crawledAt,
  operatingMode: "hourly_collection_manual_analysis",
  dryRun: !args.ingest,
  automaticAnalysisSelection: args.autoSelectAnalysis,
  runStatus,
  sourceKeys: selectedSources.map((source) => source.key),
  limits: plan.limits,
  counts: {
    collected: collected.length,
    afterFilters: filtered.length,
    candidates: plan.candidatePool.length,
    withFullText: plan.candidatePool.filter(hasUsableFullText).length,
    duplicates: duplicates.length,
    errors: errors.length,
    L0: preliminaryPlan.counts.L0,
    L1: plan.counts.L1,
    L2: plan.counts.L2,
    L3: plan.counts.L3,
    ingestSelected: plan.counts.ingestSelected,
    manualEligible: plan.counts.manualEligible,
    recommendedAnalysis: plan.counts.recommendedAnalysis,
    analysisSelected: plan.counts.analysisSelected,
    queueOverflow: plan.counts.queueOverflow
  },
  candidates: plan.candidatePool,
  excludedCandidates: preliminaryPlan.excluded.map(toCandidateSummary),
  ingestSelection: plan.ingestCandidates.map(toCandidateSummary),
  pendingQueue: plan.pendingQueue.map(toCandidateSummary),
  recommendedAnalysisQueue: plan.recommendedAnalysisQueue.map(toCandidateSummary),
  analysisQueue: plan.analysisQueue.map(toCandidateSummary),
  deferredManualCandidates: plan.deferredManualCandidates.map(toCandidateSummary),
  sourceHealth: finalizedSourceHealth,
  duplicates,
  errors
};

await writeJson(args.out, output);
printSummary(output, args.out);

if (args.ingest) {
  if (runStatus === "failed") {
    throw new Error("Crawler run is failed because at least one selected source produced candidates but no usable full text; ingest was blocked.");
  }
  await ingestCandidates(plan.ingestCandidates, args, plan);
}

function parseArgs(argv) {
  const parsed = {
    source: "all",
    sourceScanLimit: DEFAULT_SOURCE_SCAN_LIMIT,
    candidateLimit: DEFAULT_CANDIDATE_LIMIT,
    ingestLimit: DEFAULT_INGEST_LIMIT,
    analysisPerRunLimit: DEFAULT_ANALYSIS_PER_RUN_LIMIT,
    pendingQueueLimit: DEFAULT_PENDING_QUEUE_LIMIT,
    out: "artifacts/policy-candidates.json",
    ingest: false,
    autoSelectAnalysis: false,
    autoPublishRequested: false,
    preflight: false,
    includeInterpretations: false,
    since: DEFAULT_POLICY_SINCE,
    excludeUndated: true
  };

  for (const arg of argv) {
    if (arg === "--ingest") parsed.ingest = true;
    else if (arg === "--auto-select-analysis") parsed.autoSelectAnalysis = true;
    else if (arg === "--manual-selection-only") parsed.autoSelectAnalysis = false;
    else if (arg === "--preflight") parsed.preflight = true;
    else if (arg === "--auto-publish") {
      parsed.ingest = true;
      parsed.autoPublishRequested = true;
    }
    else if (arg === "--include-interpretations") parsed.includeInterpretations = true;
    else if (arg === "--include-undated") parsed.excludeUndated = false;
    else if (arg === "--exclude-undated") parsed.excludeUndated = true;
    else if (arg.startsWith("--source=")) parsed.source = arg.slice("--source=".length);
    else if (arg.startsWith("--limit=")) parsed.candidateLimit = parsePositiveInteger(arg.slice("--limit=".length), parsed.candidateLimit);
    else if (arg.startsWith("--source-scan-limit=")) parsed.sourceScanLimit = parsePositiveInteger(arg.slice("--source-scan-limit=".length), parsed.sourceScanLimit);
    else if (arg.startsWith("--candidate-limit=")) parsed.candidateLimit = parsePositiveInteger(arg.slice("--candidate-limit=".length), parsed.candidateLimit);
    else if (arg.startsWith("--ingest-limit=")) parsed.ingestLimit = parsePositiveInteger(arg.slice("--ingest-limit=".length), parsed.ingestLimit);
    else if (arg.startsWith("--analysis-limit=")) parsed.analysisPerRunLimit = parsePositiveInteger(arg.slice("--analysis-limit=".length), parsed.analysisPerRunLimit);
    else if (arg.startsWith("--pending-queue-limit=")) parsed.pendingQueueLimit = parsePositiveInteger(arg.slice("--pending-queue-limit=".length), parsed.pendingQueueLimit);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg.startsWith("--since=")) parsed.since = normalizeDate(arg.slice("--since=".length)) ?? "";
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return parsed;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function printHelp() {
  console.log(`
Usage:
  npm run crawl:sources
  npm run crawl:sources -- --source=gov_zhengce_latest,nda_policy_release --candidate-limit=20
  npm run crawl:sources -- --since=2026-01-01 --out=artifacts/policy-candidates.json
  npm run crawl:sources -- --ingest

Options:
  --source=<keys|all>          Comma-separated source keys. Default: all.
  --source-scan-limit=<n>     Max list rows scanned per source. Default: ${DEFAULT_SOURCE_SCAN_LIMIT}.
  --candidate-limit=<n>       Global non-L0 candidate cap. Default: ${DEFAULT_CANDIDATE_LIMIT}.
  --limit=<n>                 Backward-compatible alias for --candidate-limit.
  --ingest-limit=<n>          Max original policy documents ingested per run. Default: ${DEFAULT_INGEST_LIMIT}.
  --analysis-limit=<n>        Max L2/L3 recommendations shown per run. Default: ${DEFAULT_ANALYSIS_PER_RUN_LIMIT}.
  --pending-queue-limit=<n>   Max high-value inbox rows shown in the artifact. Default: ${DEFAULT_PENDING_QUEUE_LIMIT}.
  --since=<YYYY-MM-DD>        Keep candidates on/after this date. Defaults to ${DEFAULT_POLICY_SINCE}.
  --include-undated           Keep candidates whose publish date cannot be parsed.
  --exclude-undated           Drop candidates whose publish date cannot be parsed. Default.
  --out=<path>                JSON output path. Default: artifacts/policy-candidates.json.
  --include-interpretations   Keep policy interpretation pages.
  --ingest                    Call Supabase Edge Function ingest for unique candidates.
  --manual-selection-only     Never create analysis jobs during collection. Default.
  --auto-select-analysis      Legacy/manual opt-in: select recommended items for analysis jobs.
  --auto-publish              Disabled. Use reviewed manual analysis after ingest.
  --preflight                 Verify Supabase function auth, crawler owner, and source seed.

Ingest environment:
  SUPABASE_URL or VITE_SUPABASE_URL
  SUPABASE_ACCESS_TOKEN       Authenticated user JWT for manual ingest.
  SUPABASE_FUNCTION_JWT       Optional JWT accepted by Supabase Edge Functions.
  SUPABASE_CRAWLER_SECRET     Optional crawler shared secret for scheduled ingest.
`);
}

async function preflightSupabaseFunctions() {
  const { supabaseUrl, accessToken, crawlerSecret } = readIngestEnvironment();
  const result = await callSupabaseFunction(supabaseUrl, "ingest", {
    headers: buildFunctionHeaders(accessToken, crawlerSecret),
    body: {
      preflight: true,
      crawlerVersion: CRAWLER_VERSION,
      checkedAt: new Date().toISOString()
    }
  });

  const activePolicySources = Number(result.activePolicySources ?? 0);
  if (!result.ok) {
    throw new Error(`Supabase preflight failed: ${JSON.stringify(result)}`);
  }
  if (activePolicySources <= 0) {
    throw new Error("Supabase preflight found no active policy_sources rows. Apply schema and seed policy sources before crawling.");
  }

  console.log(`[preflight] ok actor=${result.actor ?? "unknown"} activePolicySources=${activePolicySources}`);
}

function selectSources(sourceArg) {
  if (!sourceArg || sourceArg === "all") return SOURCES;

  const keys = new Set(sourceArg.split(",").map((item) => item.trim()).filter(Boolean));
  const selected = SOURCES.filter((source) => keys.has(source.key));
  const missing = [...keys].filter((key) => !SOURCES.some((source) => source.key === key));

  if (missing.length) {
    throw new Error(`Unknown source key(s): ${missing.join(", ")}`);
  }

  return selected;
}

async function fetchGovLatest(source, args) {
  const jsonUrl = new URL("ZUIXINZHENGCE.json", source.listUrl).href;
  const data = await fetchJson(jsonUrl);

  if (!Array.isArray(data)) {
    throw new Error("Gov latest JSON did not return an array.");
  }

  return data.slice(0, Math.min(data.length, args.sourceScanLimit)).map((item) =>
    makeCandidate(source, {
      title: item.TITLE,
      sourceUrl: item.URL,
      publishDate: item.DOCRELPUBTIME,
      publishDateTime: item.DOCRELPUBTIME,
      raw: {
        origin: "gov-json",
        subTitle: item.SUB_TITLE ?? ""
      }
    })
  );
}

async function fetchNdrcDocuments(source, args) {
  const params = new URLSearchParams({
    qt: "",
    tab: "all",
    page: "1",
    pageSize: String(Math.min(args.sourceScanLimit, 100)),
    siteCode: "bm04000fgk",
    key: "CAB549A94CF659904A7D6B0E8FC8A7E9",
    startDateStr: "",
    endDateStr: "",
    timeOption: "0",
    sort: "dateDesc"
  });
  const data = await fetchJson(`https://fwfx.ndrc.gov.cn/api/query?${params}`, {
    referer: source.listUrl
  });
  const rows = data?.data?.resultList;

  if (!Array.isArray(rows)) {
    throw new Error("NDRC API response did not contain data.resultList.");
  }

  return rows.map((item) =>
    makeCandidate(source, {
      title: item.title ?? item.dreTitle,
      sourceUrl: item.url,
      publishDate: item.docDate,
      publishDateTime: item.docDate,
      issuer: item.domainSiteName ?? source.issuer,
      policyNo: extractPolicyNo(item.title ?? item.dreTitle),
      raw: {
        origin: "ndrc-api",
        category: item.myValues?.C8,
        reference: item.reference
      }
    })
  );
}

async function fetchMiitDocuments(source, args) {
  const richFields =
    "title,content,deploytime,_index,url,cdate,infoextends,infocontentattribute,columnname,filenumbername,publishgroupname,publishtime,metaid,bexxgk,columnid,xxgkextend1,xxgkextend2,themename,typename,indexcode,createdate";
  const compactFields =
    "title,url,deploytime,cdate,infocontent,columnname,filenumbername,publishgroupname,publishtime,metaid,typename";

  try {
    const rows = await fetchMiitSearchRows(source, {
      pageSize: Math.max(Math.min(args.sourceScanLimit, 50), 20),
      selectFields: richFields,
      mode: "rich"
    });
    return mapMiitRows(source, rows, "miit-search-api-rich");
  } catch (primaryError) {
    printWorkflowWarning(`MIIT rich search failed; retrying compact query: ${getErrorMessage(primaryError)}`);
    const rows = await fetchMiitSearchRows(source, {
      pageSize: 20,
      selectFields: compactFields,
      mode: "compact"
    });
    return mapMiitRows(source, rows, "miit-search-api-compact-fallback");
  }
}

async function fetchMiitSearchRows(source, input) {
  const params = new URLSearchParams({
    websiteid: "110000000000000",
    scope: "basic",
    q: "",
    pg: String(input.pageSize),
    cateid: "196",
    pos: "title_text,infocontent,titlepy",
    _cus_eq_typename: "",
    _cus_eq_publishgroupname: "",
    _cus_eq_themename: "",
    begin: "",
    end: "",
    dateField: "deploytime",
    selectFields: input.selectFields,
    group: "distinct",
    highlightConfigs: JSON.stringify([
      { field: "infocontent", numberOfFragments: 2, fragmentOffset: 0, fragmentSize: 30, noMatchSize: 145 }
    ]),
    highlightFields: "title_text,infocontent,webid",
    level: "6",
    sortFields: JSON.stringify([{ name: "deploytime", type: "desc" }]),
    p: "1"
  });
  const data = await fetchJson(`https://www.miit.gov.cn/search-front-server/api/search/info?${params}`, {
    referer: source.listUrl,
    accept: "application/json, text/plain, */*",
    attempts: input.mode === "compact" ? 4 : 3,
    timeoutMs: 30_000,
    backoffMs: input.mode === "compact" ? [2_000, 5_000, 9_000] : [1_000, 3_000]
  });
  const rows = data?.data?.searchResult?.dataResults;
  if (!Array.isArray(rows)) {
    throw new Error(`MIIT ${input.mode} API response did not contain data.searchResult.dataResults.`);
  }
  return rows;
}

function mapMiitRows(source, rows, origin) {
  return rows.map((row) => {
    const item = row.groupData?.[0]?.data ?? row.data ?? row;
    const searchContentPreview = htmlToText(extractMiitContentHtml(item.infoextends) ?? item.infocontent ?? "");

    return makeCandidate(source, {
      title: item.title ?? item.title_text,
      sourceUrl: item.url,
      publishDate: item.jsearch_date ?? item.deploytime ?? item.publishtime ?? item.cdate,
      publishDateTime: item.jsearch_date ?? item.deploytime ?? item.publishtime ?? item.cdate,
      issuer: item.publishgroupname ?? item.xxgkextend2 ?? source.issuer,
      policyNo: item.filenumbername ?? extractPolicyNo(item.title ?? item.title_text),
      raw: {
        origin,
        typename: item.typename,
        themename: item.themename,
        columnname: item.columnname,
        metaid: item.metaid,
        searchContentPreview,
        searchContentPreviewLength: searchContentPreview.length
      }
    });
  });
}

async function fetchNdaPolicyRelease(source) {
  const html = await fetchText(source.listUrl);
  const $ = cheerio.load(html);
  const candidates = [];

  $("a[href]").each((_, anchor) => {
    const title = cleanText($(anchor).text());
    const href = $(anchor).attr("href");
    if (!title || !href || !href.includes("/zcfb/")) return;

    const sourceUrl = new URL(href, source.listUrl).href;
    const parentText = cleanText($(anchor).parent().text());
    const publishDate = normalizeDate(parentText.match(/(\d{4})[.-](\d{2})[.-](\d{2})/)?.[0]);
    const publishDateTime = normalizeDateTime(parentText);

    candidates.push(
      makeCandidate(source, {
        title,
        sourceUrl,
        publishDate,
        publishDateTime,
        policyNo: extractPolicyNo(title),
        raw: {
          origin: "nda-html-list"
        }
      })
    );
  });

  return candidates;
}

function makeCandidate(source, input) {
  const title = cleanText(input.title);
  const sourceUrl = normalizeUrl(resolveUrl(input.sourceUrl, source.listUrl));
  const publishDateTime = normalizeDateTime(input.publishDateTime ?? input.officialPublishedAt ?? input.sourcePublishedAt ?? input.publishDate);
  const publishDate = normalizeDate(input.publishDate) ?? (publishDateTime ? publishDateTime.slice(0, 10) : null);
  const issuer = cleanText(input.issuer) || source.issuer;
  const policyNo = cleanText(input.policyNo) || extractPolicyNo(title);
  const fullText = normalizePolicyText(input.fullText);
  const canonicalSourceUrl = normalizeUrl(resolveUrl(input.canonicalSourceUrl ?? sourceUrl, source.listUrl));
  const dedupeKey = buildDedupeKey({ title, issuer, publishDate, policyNo, canonicalSourceUrl });
  const contentHash = input.contentHash ?? (isUsablePolicyText(fullText) ? hashText(fullText) : null);

  return {
    sourceKey: source.key,
    sourceName: source.name,
    sourcePriority: source.priority,
    title,
    sourceUrl,
    canonicalSourceUrl,
    issuer,
    publishDate,
    publishDateTime,
    officialPublishedAt: publishDateTime,
    publishTimezone: publishDateTime ? "Asia/Shanghai" : null,
    policyNo,
    dedupeKey,
    contentHash,
    fullText: fullText || null,
    raw: input.raw ?? {}
  };
}

function dedupeCandidates(items) {
  const canonicalByKey = new Map();
  const duplicates = [];

  for (const item of items.filter((candidate) => candidate.title && candidate.sourceUrl)) {
    const key = item.contentHash || item.dedupeKey || item.canonicalSourceUrl;
    const existing = canonicalByKey.get(key);

    if (!existing) {
      canonicalByKey.set(key, item);
      continue;
    }

    const preferred = pickPreferred(existing, item);
    const duplicate = preferred === existing ? item : existing;
    canonicalByKey.set(key, preferred);
    duplicates.push({
      duplicateOf: preferred.sourceUrl,
      reason: item.contentHash && existing.contentHash === item.contentHash ? "contentHash" : "dedupeKey",
      candidate: duplicate
    });
  }

  const candidates = [...canonicalByKey.values()].sort((a, b) => {
    const dateOrder = (b.publishDate || "").localeCompare(a.publishDate || "");
    if (dateOrder) return dateOrder;
    const timeOrder = (b.publishDateTime || "").localeCompare(a.publishDateTime || "");
    if (timeOrder) return timeOrder;
    return b.sourcePriority - a.sourcePriority;
  });

  return { candidates, duplicates };
}

function pickPreferred(a, b) {
  if (a.policyNo && !b.policyNo) return a;
  if (b.policyNo && !a.policyNo) return b;
  if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority > b.sourcePriority ? a : b;
  if ((a.publishDateTime || "") !== (b.publishDateTime || "")) {
    return (a.publishDateTime || "") >= (b.publishDateTime || "") ? a : b;
  }
  return (a.publishDate || "") >= (b.publishDate || "") ? a : b;
}

async function hydrateCandidates(candidates) {
  const hydrated = [];

  for (const candidate of candidates) {
    if (hasUsableFullText(candidate)) {
      hydrated.push(candidate);
      continue;
    }

    try {
      const html = await fetchText(candidate.sourceUrl, { referer: candidate.canonicalSourceUrl });
      const pageText = extractPolicyTextFromHtml(html, candidate.sourceKey);
      const attachmentResult = await hydratePolicyAttachments({
        html,
        pageText,
        baseUrl: candidate.sourceUrl,
        fetchBinary
      });
      hydrated.push(attachFullText(candidate, attachmentResult.selectedText, html, attachmentResult));
    } catch (error) {
      hydrated.push({
        ...candidate,
        raw: {
          ...candidate.raw,
          hydrationError: getErrorMessage(error)
        }
      });
    }
  }

  return hydrated;
}

function attachFullText(candidate, value, html = "", attachmentResult = null) {
  const fullText = normalizePolicyText(value);
  const officialPublishedAt = extractOfficialPublishedAtFromHtml(html, candidate.sourceKey) ?? candidate.officialPublishedAt ?? candidate.publishDateTime;
  const publishDate = candidate.publishDate ?? (officialPublishedAt ? officialPublishedAt.slice(0, 10) : null);
  return {
    ...candidate,
    publishDate,
    publishDateTime: officialPublishedAt ?? candidate.publishDateTime,
    officialPublishedAt: officialPublishedAt ?? candidate.officialPublishedAt,
    publishTimezone: (officialPublishedAt ?? candidate.publishDateTime) ? "Asia/Shanghai" : candidate.publishTimezone,
    fullText: fullText || null,
    contentHash: isUsablePolicyText(fullText) ? hashText(fullText) : candidate.contentHash,
    raw: {
      ...candidate.raw,
      fullTextLength: fullText.length,
      hydratedAt: crawledAt,
      ...(attachmentResult
        ? {
            attachments: attachmentResult.attachments,
            wrapperLikely: attachmentResult.wrapperLikely,
            attachmentExtractionStatus: attachmentResult.attachmentExtractionStatus,
            attachmentEvidenceIncomplete: attachmentResult.attachmentEvidenceIncomplete,
            attachmentReviewReason: attachmentResult.attachmentEvidenceIncomplete
              ? "等待PDF/OFD附件完整正文采集"
              : null,
            attachmentTextLength: attachmentResult.extractedAttachmentTextLength,
            attachmentErrors: attachmentResult.errors
          }
        : {})
    }
  };
}

async function ingestCandidates(candidates, args, plan) {
  const { supabaseUrl, accessToken, crawlerSecret } = readIngestEnvironment();
  const analysisQueueKeys = new Set(plan.analysisQueue.map(candidateIdentity));

  let created = 0;
  let linkedDuplicates = 0;
  let skippedWithoutFullText = 0;

  for (const candidate of candidates) {
    const triage = candidate.triage ?? attachPolicyTriage(candidate).triage;
    const identity = candidateIdentity(candidate);
    const manualAnalysisEligible = triage.requiresManualAnalysis;
    const attachmentEvidenceIncomplete = candidate.raw?.attachmentEvidenceIncomplete === true;
    const requiresManualAnalysis = manualAnalysisEligible && !attachmentEvidenceIncomplete;
    const analysisQueueSelected = args.autoSelectAnalysis && requiresManualAnalysis && analysisQueueKeys.has(identity);
    const manualReviewDisposition = attachmentEvidenceIncomplete
      ? "awaiting_evidence"
      : analysisQueueSelected
        ? "selected_for_analysis"
        : manualAnalysisEligible
          ? "pending_review"
          : "archived_without_analysis";
    const manualReviewReason = attachmentEvidenceIncomplete
      ? cleanText(candidate.raw?.attachmentReviewReason) || "等待PDF/OFD附件完整正文采集"
      : null;

    if (!hasUsableFullText(candidate)) {
      skippedWithoutFullText += 1;
      console.warn(`[ingest] skipped without policy full text: ${candidate.sourceKey} ${candidate.title}`);
      continue;
    }

    const result = await callSupabaseFunction(supabaseUrl, "ingest", {
      headers: buildFunctionHeaders(accessToken, crawlerSecret),
      body: {
        sourceUrl: candidate.sourceUrl,
        title: candidate.title,
        sourceName: candidate.sourceName,
        sourceKey: candidate.sourceKey,
        issuer: candidate.issuer,
        publishDate: candidate.publishDate,
        publishDateTime: candidate.publishDateTime,
        officialPublishedAt: candidate.officialPublishedAt,
        publishTimezone: candidate.publishTimezone,
        policyNo: candidate.policyNo,
        canonicalSourceUrl: candidate.canonicalSourceUrl,
        contentHash: candidate.contentHash,
        fullText: candidate.fullText,
        analysisDepth: triage.analysisDepth,
        reviewPriority: triage.reviewPriority,
        manualAnalysisEligible,
        requiresManualAnalysis,
        analysisQueueSelected,
        manualReviewDisposition,
        manualReviewReason,
        triageReasons: triage.reasons,
        triageSignals: triage.signals,
        inputPayload: {
          crawlerVersion: CRAWLER_VERSION,
          crawledAt,
          fullTextLength: candidate.fullText?.length ?? 0,
          publishDateTime: candidate.publishDateTime,
          publish_date_time: candidate.publishDateTime,
          officialPublishedAt: candidate.officialPublishedAt,
          official_published_at: candidate.officialPublishedAt,
          publishTimezone: candidate.publishTimezone,
          publish_timezone: candidate.publishTimezone,
          dedupeKey: candidate.dedupeKey,
          analysisDepth: triage.analysisDepth,
          analysis_depth: triage.analysisDepth,
          reviewPriority: triage.reviewPriority,
          review_priority: triage.reviewPriority,
          manualAnalysisEligible,
          manual_analysis_eligible: manualAnalysisEligible,
          requiresManualAnalysis,
          requires_manual_analysis: requiresManualAnalysis,
          analysisQueueSelected,
          analysis_queue_selected: analysisQueueSelected,
          manualReviewDisposition,
          manual_review_disposition: manualReviewDisposition,
          manualReviewReason,
          manual_review_reason: manualReviewReason,
          collectionMode: "hourly_collection_manual_analysis",
          collection_mode: "hourly_collection_manual_analysis",
          triageReasons: triage.reasons,
          triage_reasons: triage.reasons,
          triageSignals: triage.signals,
          triage_signals: triage.signals,
          raw: candidate.raw
        }
      }
    });

    if (result.duplicate) linkedDuplicates += 1;
    else created += 1;
  }

  console.log(`[ingest] created=${created} linkedDuplicates=${linkedDuplicates} skippedWithoutFullText=${skippedWithoutFullText}`);
  if (skippedWithoutFullText > 0) {
    printWorkflowWarning(`${skippedWithoutFullText} candidates were skipped because policy full text could not be extracted.`);
  }
}

function candidateIdentity(candidate) {
  return candidate?.dedupeKey || candidate?.contentHash || candidate?.canonicalSourceUrl || candidate?.sourceUrl || candidate?.title;
}

function readIngestEnvironment() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const accessToken =
    process.env.SUPABASE_ACCESS_TOKEN ||
    process.env.SUPABASE_FUNCTION_JWT ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  const crawlerSecret = process.env.SUPABASE_CRAWLER_SECRET;

  if (!supabaseUrl || (!accessToken && !crawlerSecret)) {
    throw new Error("Ingest requires SUPABASE_URL or VITE_SUPABASE_URL, plus SUPABASE_ACCESS_TOKEN or SUPABASE_CRAWLER_SECRET.");
  }

  return { supabaseUrl, accessToken, crawlerSecret };
}

function buildFunctionHeaders(accessToken, crawlerSecret) {
  return {
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    ...(crawlerSecret ? { "x-crawler-secret": crawlerSecret } : {}),
    "content-type": "application/json"
  };
}

async function callSupabaseFunction(supabaseUrl, functionName, { headers, body }) {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`${functionName} failed: ${response.status} ${JSON.stringify(result)}`);
  }

  return result;
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

async function fetchText(url, options = {}) {
  const response = await fetchBinary(url, options);
  let text = new TextDecoder("utf-8").decode(response.buffer);
  let replacementCount = 0;
  for (const char of text) {
    if (char.charCodeAt(0) === 0xfffd) replacementCount += 1;
  }
  if (replacementCount > 20) {
    text = new TextDecoder("gb18030").decode(response.buffer);
  }
  return text;
}

async function fetchBinary(url, options = {}) {
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0 ? options.attempts : 3;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 20_000;
  const backoffMs = Array.isArray(options.backoffMs) ? options.backoffMs : [1_000, 2_000, 4_000];
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : null;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 policy-impact-terminal crawler",
          accept: options.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9",
          connection: "close",
          ...(options.referer ? { referer: options.referer } : {})
        }
      });

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!retryable || attempt === attempts) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }
        lastError = new Error(`HTTP ${response.status} for ${url}`);
      } else {
        const contentLength = Number(response.headers.get("content-length"));
        if (maxBytes && Number.isFinite(contentLength) && contentLength > maxBytes) {
          throw new Error(`Response exceeds ${maxBytes} bytes for ${url}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (maxBytes && buffer.length > maxBytes) {
          throw new Error(`Response exceeds ${maxBytes} bytes for ${url}`);
        }
        return {
          buffer,
          contentType: response.headers.get("content-type"),
          finalUrl: response.url || url
        };
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }

    const waitMs = Number(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)]) || attempt * 1_000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  throw new Error(`fetch failed after ${attempts} attempts for ${url}: ${getErrorMessage(lastError)}`);
}

async function writeJson(filePath, data) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function finalizeSourceHealth(sourceHealth, filtered, hydrated) {
  return sourceHealth.map((item) => {
    const filteredCandidates = filtered.filter((candidate) => candidate.sourceKey === item.sourceKey).length;
    const hydratedRows = hydrated.filter((candidate) => candidate.sourceKey === item.sourceKey);
    const withFullText = hydratedRows.filter(hasUsableFullText).length;
    const extractionFailed = hydratedRows.length > 0 && withFullText === 0;
    return {
      ...item,
      status: item.status === "failed" || extractionFailed ? "failed" : "ok",
      filteredCandidates,
      hydratedCandidates: hydratedRows.length,
      withFullText,
      extractionRate: hydratedRows.length === 0 ? null : Number((withFullText / hydratedRows.length).toFixed(3)),
      ...(extractionFailed && !item.error ? { error: "selected candidates produced no usable policy full text" } : {})
    };
  });
}

function toCandidateSummary(candidate) {
  return {
    sourceKey: candidate.sourceKey,
    title: candidate.title,
    issuer: candidate.issuer,
    publishDate: candidate.publishDate,
    publishDateTime: candidate.publishDateTime,
    sourceUrl: candidate.sourceUrl,
    canonicalSourceUrl: candidate.canonicalSourceUrl,
    policyNo: candidate.policyNo,
    contentHash: candidate.contentHash,
    dedupeKey: candidate.dedupeKey,
    hasFullText: hasUsableFullText(candidate),
    triage: candidate.triage
  };
}

function printSummary(output, outPath) {
  console.log(`[summary] status=${output.runStatus} collected=${output.counts.collected} filtered=${output.counts.afterFilters} candidates=${output.counts.candidates} withFullText=${output.counts.withFullText} duplicates=${output.counts.duplicates} errors=${output.counts.errors}`);
  console.log(`[summary] layers L0=${output.counts.L0} L1=${output.counts.L1} L2=${output.counts.L2} L3=${output.counts.L3} ingest=${output.counts.ingestSelected} recommended=${output.counts.recommendedAnalysis} selected=${output.counts.analysisSelected} overflow=${output.counts.queueOverflow}`);
  console.log(`[summary] wrote ${path.resolve(outPath)}`);
  if (output.counts.errors > 0) {
    printWorkflowWarning(`${output.counts.errors} source crawler errors occurred. Check artifacts/policy-candidates.json for details.`);
  }
  if (output.counts.candidates > 0 && output.counts.withFullText === 0) {
    printWorkflowWarning("Crawler found candidates but extracted no usable policy full text. Source page selectors may need updating.");
  }
  for (const item of output.recommendedAnalysisQueue.slice(0, 8)) {
    console.log(`- recommend ${item.publishDateTime || item.publishDate || "no-date"} ${item.triage.analysisDepth}/${item.triage.reviewPriority} ${item.sourceKey} ${item.title}`);
  }
  if (!output.automaticAnalysisSelection && output.counts.analysisSelected !== 0) {
    printWorkflowWarning("Manual-selection-only mode produced automatic analysis selections; this is a contract violation.");
  }
}

function printWorkflowWarning(message) {
  if (process.env.GITHUB_ACTIONS) {
    console.warn(`::warning::${message}`);
    return;
  }

  console.warn(`[warning] ${message}`);
}

function hasUsableFullText(candidate) {
  return isUsablePolicyText(candidate?.fullText);
}

function isUsablePolicyText(value) {
  return normalizePolicyText(value).length >= MIN_POLICY_FULL_TEXT_LENGTH;
}

function isNonPolicyDocument(item) {
  if (!item?.title || !item?.sourceUrl) return true;
  if (isInterpretation(item.title, item.sourceUrl, item.raw)) return true;

  const pathName = getUrlPath(item.sourceUrl);
  const rawText = getRawText(item.raw);

  switch (item.sourceKey) {
    case "gov_zhengce_latest":
      return !pathName.includes("/zhengce/") || /\/xinwen\/|\/yaowen\/|\/hudong\//i.test(pathName);

    case "ndrc_policy_documents":
      return !pathName.includes("/xxgk/zcfb/") || /政策解读|解读|新闻发布|答记者问/.test(rawText);

    case "miit_policy_library":
      return /政策解读|解读|图解|访谈|新闻发布/.test(rawText);

    case "nda_policy_release":
      return !pathName.includes("/zcfb/");

    default:
      return false;
  }
}

function isInterpretation(title, sourceUrl, raw = {}) {
  const text = `${title} ${sourceUrl} ${getRawText(raw)}`.toLowerCase();
  return /解读|一图读懂|图解|专家解读|答记者问|新闻发布会|访谈|评论|\/jd\/|\/zjjd\/|\/ytdd\/|\/jiedu\/|\/xwfbh\//i.test(text);
}

function getUrlPath(value) {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return String(value ?? "").toLowerCase();
  }
}

function getRawText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(getRawText).join(" ");
  if (typeof value === "object") return Object.values(value).map(getRawText).join(" ");
  return String(value);
}

function buildDedupeKey(input) {
  const normalizedPolicyNo = normalizeText(input.policyNo);
  const normalizedIssuer = normalizeText(input.issuer);
  const normalizedTitle = normalizeText(input.title);

  if (normalizedPolicyNo) {
    return `policy-no:${normalizedIssuer || "unknown"}:${normalizedPolicyNo}`;
  }

  if (normalizedTitle && input.publishDate) {
    return `title-date:${normalizedIssuer || "unknown"}:${input.publishDate}:${normalizedTitle}`;
  }

  return input.canonicalSourceUrl ? `url:${input.canonicalSourceUrl}` : null;
}

function extractPolicyNo(value) {
  const text = cleanText(value);
  if (!text) return null;

  return (
    text.match(/[^\s，,。；;（）()]*〔\d{4}〕\s*\d+\s*号/)?.[0] ??
    text.match(/[^\s，,。；;（）()]*\d{4}年第\d+号/)?.[0] ??
    null
  );
}

function extractMiitContentHtml(infoextends) {
  if (!infoextends || typeof infoextends !== "string") return null;

  try {
    const parsed = JSON.parse(infoextends);
    const fields = JSON.parse(parsed.infoContent ?? "[]");
    return fields.find((field) => field.fieldName === "content")?.fieldValue ?? null;
  } catch {
    return null;
  }
}

function extractPolicyTextFromHtml(html, sourceKey) {
  if (!html) return "";

  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, nav, header, footer").remove();

  const sharedSelectors = [
    "#UCAP-CONTENT",
    "#Zoom",
    "#zoom",
    ".TRS_Editor",
    ".pages_content",
    ".article-content",
    ".article_con",
    ".article",
    ".content",
    ".detail",
    "article",
    "main"
  ];
  const selectorsBySource = {
    gov_zhengce_latest: ["#UCAP-CONTENT", ".pages_content", "#Zoom", ".TRS_Editor", ".article"],
    ndrc_policy_documents: [".TRS_Editor", ".article_con", ".article-content", "#zoom", ".content"],
    nda_policy_release: [".TRS_Editor", ".article-content", ".detail", ".content", "article"]
  };
  const selectors = [...(selectorsBySource[sourceKey] ?? []), ...sharedSelectors];

  for (const selector of selectors) {
    const text = normalizePolicyText($(selector).first().text());
    if (text.length > 120) return text;
  }

  let bestText = "";
  $("article, main, .content, .detail, .article, body").each((_, element) => {
    const text = normalizePolicyText($(element).text());
    if (text.length > bestText.length) bestText = text;
  });

  return bestText.length > 80 ? bestText : "";
}

function extractOfficialPublishedAtFromHtml(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const visibleCandidates = [];

  [
    "#con_time",
    ".con_time",
    ".article-info",
    ".article-meta",
    ".info",
    ".source",
    ".time",
    ".date"
  ].forEach((selector) => {
    const text = cleanText($(selector).first().text());
    if (text) visibleCandidates.push(text);
  });

  const bodyText = cleanText($("body").text());
  const bodyMatches = [
    bodyText.match(/发布时间[：:\s]*(\d{4}\s*(?:年|[./-])\s*\d{1,2}\s*(?:月|[./-])\s*\d{1,2}\s*(?:日)?\s*\d{1,2}[:：]\d{2})/)?.[1],
    bodyText.match(/发布日期[：:\s]*(\d{4}\s*(?:年|[./-])\s*\d{1,2}\s*(?:月|[./-])\s*\d{1,2}\s*(?:日)?\s*\d{1,2}[:：]\d{2})/)?.[1]
  ].filter(Boolean);

  for (const candidate of [...visibleCandidates, ...bodyMatches]) {
    const normalized = normalizeDateTime(candidate);
    if (normalized) return normalized;
  }

  const metaCandidates = [
    "meta[name='PubDate']",
    "meta[name='publishdate']",
    "meta[name='publishDate']",
    "meta[name='date']",
    "meta[property='article:published_time']"
  ].map((selector) => $(selector).attr("content")).filter(Boolean);

  for (const candidate of metaCandidates) {
    const normalized = normalizeDateTime(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function htmlToText(value) {
  return cleanText(cheerio.load(value).text());
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizePolicyText(value) {
  if (typeof value !== "string") return "";

  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  const match = raw.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }

  return null;
}

function normalizeDateTime(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : formatDateTimeInShanghai(date);
  }

  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : formatDateTimeInShanghai(date);
  }

  const match = raw.match(/(\d{4})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*(?:日)?(?:[T\s]+|[^\d]{0,4})(\d{1,2})[:：](\d{2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")} ${match[4].padStart(2, "0")}:${match[5]}`;
  }

  return null;
}

function formatDateTimeInShanghai(date) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function normalizeText(value) {
  const text = cleanText(value);
  if (!text) return null;

  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[《》“”"'[\]【】()（）,，.。;；:：\-_—\s\u3000]/g, "");

  return normalized || null;
}

function resolveUrl(value, baseUrl) {
  const text = cleanText(value);
  if (!text) return null;

  try {
    return new URL(text, baseUrl).href;
  } catch {
    return text;
  }
}

function normalizeUrl(value) {
  const text = cleanText(value);
  if (!text) return null;

  try {
    const url = new URL(text);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|spm|from|source|share)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return text;
  }
}

function hashText(value) {
  return crypto.createHash("sha256").update(normalizeText(value) ?? value).digest("hex");
}

async function loadEnvFiles(files) {
  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const [key, ...rest] = trimmed.split("=");
        if (!process.env[key]) {
          process.env[key] = rest.join("=").replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      // Optional env files.
    }
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
