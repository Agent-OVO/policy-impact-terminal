#!/usr/bin/env node
import * as cheerio from "cheerio";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CRAWLER_VERSION = "policy-source-crawler-v0.2";
const MIN_POLICY_FULL_TEXT_LENGTH = 280;

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

for (const source of selectedSources) {
  try {
    const items = await source.fetch(source, args);
    collected.push(...items);
    console.log(`[crawl] ${source.key}: ${items.length} candidates`);
  } catch (error) {
    errors.push({ sourceKey: source.key, message: getErrorMessage(error) });
    console.error(`[crawl] ${source.key}: ${getErrorMessage(error)}`);
  }
}

const filtered = collected
  .filter((item) => args.includeInterpretations || !isNonPolicyDocument(item))
  .filter((item) => !args.since || !item.publishDate || item.publishDate >= args.since);

const deduped = dedupeCandidates(filtered);
const candidates = await hydrateCandidates(deduped.candidates.slice(0, args.limit));
const duplicates = deduped.duplicates;
const output = {
  crawlerVersion: CRAWLER_VERSION,
  crawledAt,
  dryRun: !args.ingest,
  sourceKeys: selectedSources.map((source) => source.key),
  counts: {
    collected: collected.length,
    afterFilters: filtered.length,
    candidates: candidates.length,
    withFullText: candidates.filter(hasUsableFullText).length,
    duplicates: duplicates.length,
    errors: errors.length
  },
  candidates,
  duplicates,
  errors
};

await writeJson(args.out, output);
printSummary(output, args.out);

if (args.ingest) {
  await ingestCandidates(candidates, args);
}

function parseArgs(argv) {
  const parsed = {
    source: "all",
    limit: 40,
    out: "artifacts/policy-candidates.json",
    ingest: false,
    autoPublish: false,
    preflight: false,
    includeInterpretations: false,
    since: ""
  };

  for (const arg of argv) {
    if (arg === "--ingest") parsed.ingest = true;
    else if (arg === "--preflight") parsed.preflight = true;
    else if (arg === "--auto-publish") {
      parsed.ingest = true;
      parsed.autoPublish = true;
    }
    else if (arg === "--include-interpretations") parsed.includeInterpretations = true;
    else if (arg.startsWith("--source=")) parsed.source = arg.slice("--source=".length);
    else if (arg.startsWith("--limit=")) parsed.limit = Number(arg.slice("--limit=".length)) || parsed.limit;
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg.startsWith("--since=")) parsed.since = normalizeDate(arg.slice("--since=".length)) ?? "";
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  npm run crawl:sources
  npm run crawl:sources -- --source=gov_zhengce_latest,nda_policy_release --limit=20
  npm run crawl:sources -- --since=2026-01-01 --out=artifacts/policy-candidates.json
  npm run crawl:sources -- --ingest

Options:
  --source=<keys|all>          Comma-separated source keys. Default: all.
  --limit=<n>                 Max candidates after filtering. Default: 40.
  --since=<YYYY-MM-DD>        Keep candidates on/after this date when date exists.
  --out=<path>                JSON output path. Default: artifacts/policy-candidates.json.
  --include-interpretations   Keep policy interpretation pages.
  --ingest                    Call Supabase Edge Function ingest for unique candidates.
  --auto-publish              After ingest, call analyze and publish for newly created jobs.
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

  return data.slice(0, Math.min(data.length, Math.max(args.limit * 3, 30))).map((item) =>
    makeCandidate(source, {
      title: item.TITLE,
      sourceUrl: item.URL,
      publishDate: item.DOCRELPUBTIME,
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
    pageSize: String(Math.min(Math.max(args.limit * 3, 30), 100)),
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
  const selectFields =
    "title,content,deploytime,_index,url,cdate,infoextends,infocontentattribute,columnname,filenumbername,publishgroupname,publishtime,metaid,bexxgk,columnid,xxgkextend1,xxgkextend2,themename,typename,indexcode,createdate";
  const params = new URLSearchParams({
    websiteid: "110000000000000",
    scope: "basic",
    q: "",
    pg: String(Math.max(Math.min(args.limit * 3, 50), 20)),
    cateid: "196",
    pos: "title_text,infocontent,titlepy",
    _cus_eq_typename: "",
    _cus_eq_publishgroupname: "",
    _cus_eq_themename: "",
    begin: "",
    end: "",
    dateField: "deploytime",
    selectFields,
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
    referer: source.listUrl
  });
  const rows = data?.data?.searchResult?.dataResults;

  if (!Array.isArray(rows)) {
    throw new Error("MIIT API response did not contain data.searchResult.dataResults.");
  }

  return rows.map((row) => {
    const item = row.groupData?.[0]?.data ?? row.data ?? row;
    const searchContentPreview = htmlToText(extractMiitContentHtml(item.infoextends) ?? item.infocontent ?? "");

    return makeCandidate(source, {
      title: item.title ?? item.title_text,
      sourceUrl: item.url,
      publishDate: item.jsearch_date ?? item.deploytime ?? item.publishtime ?? item.cdate,
      issuer: item.publishgroupname ?? item.xxgkextend2 ?? source.issuer,
      policyNo: item.filenumbername ?? extractPolicyNo(item.title ?? item.title_text),
      raw: {
        origin: "miit-search-api",
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

    candidates.push(
      makeCandidate(source, {
        title,
        sourceUrl,
        publishDate,
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
  const publishDate = normalizeDate(input.publishDate);
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
    return b.sourcePriority - a.sourcePriority;
  });

  return { candidates, duplicates };
}

function pickPreferred(a, b) {
  if (a.policyNo && !b.policyNo) return a;
  if (b.policyNo && !a.policyNo) return b;
  if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority > b.sourcePriority ? a : b;
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
      hydrated.push(attachFullText(candidate, extractPolicyTextFromHtml(html, candidate.sourceKey)));
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

function attachFullText(candidate, value) {
  const fullText = normalizePolicyText(value);
  return {
    ...candidate,
    fullText: fullText || null,
    contentHash: candidate.contentHash ?? (isUsablePolicyText(fullText) ? hashText(fullText) : null),
    raw: {
      ...candidate.raw,
      fullTextLength: fullText.length,
      hydratedAt: crawledAt
    }
  };
}

async function ingestCandidates(candidates, args) {
  const { supabaseUrl, accessToken, crawlerSecret } = readIngestEnvironment();

  let created = 0;
  let linkedDuplicates = 0;
  let analyzed = 0;
  let published = 0;
  let skippedWithoutFullText = 0;

  for (const candidate of candidates) {
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
        policyNo: candidate.policyNo,
        canonicalSourceUrl: candidate.canonicalSourceUrl,
        contentHash: candidate.contentHash,
        fullText: candidate.fullText,
        inputPayload: {
          crawlerVersion: CRAWLER_VERSION,
          crawledAt,
          fullTextLength: candidate.fullText?.length ?? 0,
          dedupeKey: candidate.dedupeKey,
          raw: candidate.raw
        }
      }
    });

    if (result.duplicate) {
      linkedDuplicates += 1;

      if (args.autoPublish && result.job?.id && result.job?.status !== "published") {
        await analyzeAndPublishJob(supabaseUrl, result.job.id, accessToken, crawlerSecret);
        analyzed += 1;
        published += 1;
      }
    } else {
      created += 1;

      if (args.autoPublish && result.job?.id) {
        await analyzeAndPublishJob(supabaseUrl, result.job.id, accessToken, crawlerSecret);
        analyzed += 1;
        published += 1;
      }
    }
  }

  console.log(`[ingest] created=${created} linkedDuplicates=${linkedDuplicates} analyzed=${analyzed} published=${published} skippedWithoutFullText=${skippedWithoutFullText}`);
  if (skippedWithoutFullText > 0) {
    printWorkflowWarning(`${skippedWithoutFullText} candidates were skipped because policy full text could not be extracted.`);
  }
  if (args.autoPublish && analyzed > 0 && published === 0) {
    printWorkflowWarning("Auto-publish was requested, but no policy report was published.");
  }
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

async function analyzeAndPublishJob(supabaseUrl, jobId, accessToken, crawlerSecret) {
  await callSupabaseFunction(supabaseUrl, "analyze", {
    headers: buildFunctionHeaders(accessToken, crawlerSecret),
    body: { jobId }
  });

  await callSupabaseFunction(supabaseUrl, "publish", {
    headers: buildFunctionHeaders(accessToken, crawlerSecret),
    body: { jobId }
  });
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
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 policy-impact-terminal crawler",
      ...(options.referer ? { referer: options.referer } : {})
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  let text = new TextDecoder("utf-8").decode(buffer);
  let replacementCount = 0;
  for (const char of text) {
    if (char.charCodeAt(0) === 0xfffd) replacementCount += 1;
  }
  if (replacementCount > 20) {
    text = new TextDecoder("gb18030").decode(buffer);
  }
  return text;
}

async function writeJson(filePath, data) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function printSummary(output, outPath) {
  console.log(`[summary] collected=${output.counts.collected} filtered=${output.counts.afterFilters} candidates=${output.counts.candidates} withFullText=${output.counts.withFullText} duplicates=${output.counts.duplicates} errors=${output.counts.errors}`);
  console.log(`[summary] wrote ${path.resolve(outPath)}`);
  if (output.counts.errors > 0) {
    printWorkflowWarning(`${output.counts.errors} source crawler errors occurred. Check artifacts/policy-candidates.json for details.`);
  }
  if (output.counts.candidates > 0 && output.counts.withFullText === 0) {
    printWorkflowWarning("Crawler found candidates but extracted no usable policy full text. Source page selectors may need updating.");
  }
  for (const item of output.candidates.slice(0, 8)) {
    console.log(`- ${item.publishDate || "no-date"} ${item.sourceKey} ${item.title}`);
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
