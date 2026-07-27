const TRACKING_PARAM = /^(utm_|spm|from|source|share)/i;
const MIN_CORE_DOCUMENT_TITLE_LENGTH = 10;
const MIN_NORMALIZED_TITLE_LENGTH = 16;

export function normalizePolicyUrl(value) {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    return url.href.replace(/\?$/, "");
  } catch {
    return text;
  }
}

export function normalizeIdentityText(value) {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[《》“”"'\[\]【】()（）,，.。;；:：\-_—\s\u3000]/g, "");
  return normalized || null;
}

export function normalizePolicyNumber(value) {
  const normalized = normalizeIdentityText(value);
  if (!normalized) return null;
  return normalized
    .replace(/^中华人民共和国/, "")
    .replace(/^(国家发展和改革委员会|国家发展改革委|工业和信息化部|国务院办公厅|国务院)/, "");
}

export function extractCoreDocumentTitle(value) {
  const text = cleanText(value);
  if (!text) return null;
  const bracketed = [...text.matchAll(/《([^》]{4,120})》/g)]
    .map((match) => match[1])
    .sort((a, b) => b.length - a.length)[0];
  const core = bracketed || text
    .replace(/^.*?关于(?:印发|公布|发布|转发|批复)/, "")
    .replace(/(?:的通知|的批复|的公告|通知|公告|批复).*$/, "");
  return normalizeIdentityText(core);
}

export function buildDedupeKey(input) {
  const policyNo = normalizePolicyNumber(input.policyNo);
  if (policyNo) return `policy-no:${policyNo}`;

  const coreTitle = extractCoreDocumentTitle(input.title);
  if (coreTitle && coreTitle.length >= MIN_CORE_DOCUMENT_TITLE_LENGTH && input.publishDate) return `document-title-date:${input.publishDate}:${coreTitle}`;

  const title = normalizeIdentityText(input.title);
  if (title && title.length >= MIN_NORMALIZED_TITLE_LENGTH && input.publishDate) {
    return `title-date:${input.publishDate}:${title}`;
  }

  const url = normalizePolicyUrl(input.canonicalSourceUrl || input.sourceUrl);
  return url ? `url:${url}` : null;
}

export function buildCandidateIdentityKeys(candidate) {
  const keys = [];
  const canonicalUrl = normalizePolicyUrl(candidate?.canonicalSourceUrl || candidate?.sourceUrl);
  const sourceUrl = normalizePolicyUrl(candidate?.sourceUrl);
  if (canonicalUrl) keys.push(`exact-url:${canonicalUrl}`);
  if (sourceUrl && sourceUrl !== canonicalUrl) keys.push(`exact-url:${sourceUrl}`);

  const policyNo = normalizePolicyNumber(candidate?.policyNo);
  if (policyNo) keys.push(`policy-no:${policyNo}`);

  const coreTitle = extractCoreDocumentTitle(candidate?.title);
  if (coreTitle && coreTitle.length >= MIN_CORE_DOCUMENT_TITLE_LENGTH && candidate?.publishDate) keys.push(`document-title-date:${candidate.publishDate}:${coreTitle}`);

  if (candidate?.dedupeKey) keys.push(`dedupe-key:${candidate.dedupeKey}`);
  if (candidate?.contentHash) keys.push(`content-hash:${candidate.contentHash}`);
  return [...new Set(keys)];
}

export function dedupeCandidates(items) {
  const canonical = [];
  const keySets = [];
  const duplicates = [];

  for (const item of items.filter((candidate) => candidate?.title && candidate?.sourceUrl)) {
    const keys = new Set(buildCandidateIdentityKeys(item));
    const existingIndex = keySets.findIndex((existingKeys) => intersects(existingKeys, keys));
    if (existingIndex < 0) {
      canonical.push(item);
      keySets.push(keys);
      continue;
    }

    const existing = canonical[existingIndex];
    const preferred = pickPreferred(existing, item);
    const duplicate = preferred === existing ? item : existing;
    const matchedKey = [...keys].find((key) => keySets[existingIndex].has(key)) || "unknown";
    canonical[existingIndex] = preferred;
    keySets[existingIndex] = new Set([...keySets[existingIndex], ...keys]);
    duplicates.push({
      duplicateOf: preferred.sourceUrl,
      duplicateOfCanonicalSourceUrl: preferred.canonicalSourceUrl || preferred.sourceUrl,
      reason: matchedKey.split(":", 1)[0],
      matchedKey,
      candidate: duplicate
    });
  }

  canonical.sort((a, b) => {
    const dateOrder = (b.publishDate || "").localeCompare(a.publishDate || "");
    if (dateOrder) return dateOrder;
    const timeOrder = (b.publishDateTime || "").localeCompare(a.publishDateTime || "");
    if (timeOrder) return timeOrder;
    return Number(b.sourcePriority || 0) - Number(a.sourcePriority || 0);
  });
  return { candidates: canonical, duplicates };
}

export function findDuplicateGroups(items) {
  const groups = new Map();
  for (const item of items) {
    for (const key of buildCandidateIdentityKeys(item).filter((value) => !value.startsWith("content-hash:"))) {
      const rows = groups.get(key) || [];
      rows.push(item);
      groups.set(key, rows);
    }
  }

  const merged = new Map();
  for (const [matchedKey, rows] of groups.entries()) {
    const policies = uniqueIds(rows);
    if (policies.length < 2) continue;
    const groupKey = policies.map((row) => row.id || row.sourceUrl).sort().join("|");
    const existing = merged.get(groupKey) || { matchedKeys: [], reasons: [], policies };
    existing.matchedKeys.push(matchedKey);
    existing.reasons.push(matchedKey.split(":", 1)[0]);
    merged.set(groupKey, existing);
  }
  return [...merged.values()].map((group) => ({
    ...group,
    matchedKeys: [...new Set(group.matchedKeys)],
    reasons: [...new Set(group.reasons)]
  }));
}

function pickPreferred(a, b) {
  const aScore = preferenceScore(a);
  const bScore = preferenceScore(b);
  if (aScore !== bScore) return aScore > bScore ? a : b;
  return String(a.sourceUrl || "").localeCompare(String(b.sourceUrl || "")) <= 0 ? a : b;
}

function preferenceScore(candidate) {
  const textLength = typeof candidate?.fullText === "string" ? candidate.fullText.trim().length : 0;
  const attachmentComplete = candidate?.raw?.attachmentEvidenceIncomplete === false ? 1 : 0;
  const policyNo = candidate?.policyNo ? 1 : 0;
  const sourcePriority = Number(candidate?.sourcePriority || 0);
  return attachmentComplete * 1_000_000_000 + sourcePriority * 1_000_000 + policyNo * 100_000 + Math.min(textLength, 500_000);
}

function intersects(a, b) {
  for (const key of a) if (b.has(key)) return true;
  return false;
}

function uniqueIds(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const id = row?.id || row?.sourceUrl || JSON.stringify(row);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(row);
  }
  return result;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
