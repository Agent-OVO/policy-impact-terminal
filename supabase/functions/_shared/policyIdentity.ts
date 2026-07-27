const MIN_CORE_DOCUMENT_TITLE_LENGTH = 10;
const MIN_NORMALIZED_TITLE_LENGTH = 16;

export type PolicyIdentityInput = {
  title?: string | null;
  publishDate?: string | null;
  policyNo?: string | null;
  canonicalSourceUrl?: string | null;
  sourceUrl?: string | null;
};

export function normalizePolicyUrl(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm|from|source|share)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    return url.href.replace(/\?$/, "");
  } catch {
    return text;
  }
}

export function normalizeIdentityText(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[《》“”"'\[\]【】()（）,，.。;；:：\-_—\s\u3000]/g, "");
  return normalized || null;
}

export function normalizePolicyNumber(value: string | null | undefined): string | null {
  const normalized = normalizeIdentityText(value);
  if (!normalized) return null;
  return normalized
    .replace(/^中华人民共和国/, "")
    .replace(/^(国家发展和改革委员会|国家发展改革委|工业和信息化部|国务院办公厅|国务院)/, "");
}

export function extractCoreDocumentTitle(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const matches = [...text.matchAll(/《([^》]{4,120})》/g)]
    .map((match) => match[1])
    .sort((a, b) => b.length - a.length);
  const core = matches[0] || text
    .replace(/^.*?关于(?:印发|公布|发布|转发|批复)/, "")
    .replace(/(?:的通知|的批复|的公告|通知|公告|批复).*$/, "");
  return normalizeIdentityText(core);
}

export function buildDedupeKey(input: PolicyIdentityInput): string | null {
  const policyNo = normalizePolicyNumber(input.policyNo);
  if (policyNo) return `policy-no:${policyNo}`;
  const coreTitle = extractCoreDocumentTitle(input.title);
  if (coreTitle && coreTitle.length >= MIN_CORE_DOCUMENT_TITLE_LENGTH && input.publishDate) {
    return `document-title-date:${input.publishDate}:${coreTitle}`;
  }
  const title = normalizeIdentityText(input.title);
  if (title && title.length >= MIN_NORMALIZED_TITLE_LENGTH && input.publishDate) {
    return `title-date:${input.publishDate}:${title}`;
  }
  const url = normalizePolicyUrl(input.canonicalSourceUrl ?? input.sourceUrl);
  return url ? `url:${url}` : null;
}

export function samePolicyIdentity(a: PolicyIdentityInput, b: PolicyIdentityInput): boolean {
  const aCanonical = normalizePolicyUrl(a.canonicalSourceUrl ?? a.sourceUrl);
  const bCanonical = normalizePolicyUrl(b.canonicalSourceUrl ?? b.sourceUrl);
  if (aCanonical && bCanonical && aCanonical === bCanonical) return true;

  const aNo = normalizePolicyNumber(a.policyNo);
  const bNo = normalizePolicyNumber(b.policyNo);
  if (aNo && bNo && aNo === bNo) return true;

  if (a.publishDate && b.publishDate && a.publishDate === b.publishDate) {
    const aTitle = extractCoreDocumentTitle(a.title);
    const bTitle = extractCoreDocumentTitle(b.title);
    if (
      aTitle &&
      bTitle &&
      aTitle.length >= MIN_CORE_DOCUMENT_TITLE_LENGTH &&
      bTitle.length >= MIN_CORE_DOCUMENT_TITLE_LENGTH &&
      aTitle === bTitle
    ) return true;
  }
  return false;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
