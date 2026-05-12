import { chainNodes } from "../../data/policy";
import type { ChainNode, Company } from "../../data/policy";

export type CompanyWithLogo = Company & {
  logoUrl?: string;
  logoDomain?: string;
};

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clampScore(value: number | null | undefined) {
  return Number.isFinite(value) ? clamp(Number(value), 0, 100) : 0;
}

export function getCompanyById(id: string | null | undefined, items: Company[] = []) {
  if (!id) return undefined;
  return items.find((company) => company.id === id);
}

export function getNodeById(id: string, items: ChainNode[] = chainNodes) {
  return items.find((node) => node.id === id);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}

export function getCompanyName(company: Pick<Company, "name" | "ticker">, fallback = "未命名公司") {
  return company.name.trim() || company.ticker.trim() || fallback;
}

export function getCompanyInitials(company: Pick<Company, "name" | "ticker">) {
  const source = getCompanyName(company, "?");
  const asciiParts = source.match(/[A-Za-z0-9]+/g);

  if (asciiParts?.length) {
    return asciiParts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  return Array.from(source.replace(/\s/g, "")).slice(0, 2).join("") || "?";
}

export function getCompanyLogoCandidates(company: CompanyWithLogo) {
  const candidates = [
    getDomainFaviconUrl(company.logoDomain),
    normalizeLogoUrl(company.logoUrl)
  ];

  return Array.from(new Set(candidates.filter(isDefined)));
}

function getDomainFaviconUrl(value: string | undefined) {
  const domain = normalizeLogoDomain(value);
  return domain ? `https://${domain}/favicon.ico` : undefined;
}

function normalizeLogoUrl(value: string | undefined) {
  const text = value?.trim();
  if (!text) return undefined;

  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeLogoDomain(value: string | undefined) {
  const text = value?.trim();
  if (!text) return undefined;

  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    const host = url.host.replace(/^www\./i, "");
    return host && !host.includes(" ") ? host : undefined;
  } catch {
    return undefined;
  }
}
