import { chainNodes } from "../../data/policy";
import type { ChainNode, Company } from "../../data/policy";

export type CompanyWithLogo = Company & {
  logoUrl?: string;
  logoDomain?: string;
};

type CompanyLogoSource = {
  keys: string[];
  domains?: string[];
  urls?: string[];
};

const knownCompanyLogoSources: CompanyLogoSource[] = [
  {
    keys: ["sh-data", "上海数据交易所"],
    domains: ["www.chinadep.com"],
    urls: ["https://www.google.com/s2/favicons?domain=chinadep.com&sz=128"]
  },
  {
    keys: ["zj-culture", "浙数文化", "浙报数字文化集团股份有限公司", "600633", "600633.SH"],
    domains: ["www.600633.cn"],
    urls: ["https://www.600633.cn/favicon.ico"]
  },
  {
    keys: ["daily", "每日互动", "浙江每日互动网络科技股份有限公司", "每日互动股份有限公司", "300766", "300766.SZ"],
    domains: ["www.ge.cn", "www.getui.com"],
    urls: ["https://gt-static.getui.com/mrtech/static/favicon.ico"]
  },
  {
    keys: ["digiwin", "数鼎科技", "广东数鼎科技有限公司", "Piston Intelligence"],
    domains: ["www.pistonint.com"]
  },
  {
    keys: ["qi-an-xin", "奇安信", "奇安信集团", "奇安信科技集团股份有限公司", "688561", "688561.SH"],
    domains: ["www.qianxin.com"],
    urls: ["https://www.qianxin.com/favicon.ico"]
  },
  {
    keys: ["aliyun", "阿里云", "阿里云计算", "阿里云计算有限公司", "Alibaba Cloud"],
    domains: ["www.aliyun.com"],
    urls: ["https://img.alicdn.com/tfs/TB1_ZXuNcfpK1RjSZFOXXa6nFXa-32-32.ico"]
  },
  {
    keys: ["digital-china", "数字政通", "北京数字政通科技股份有限公司", "300075", "300075.SZ"],
    domains: ["www.egova.com.cn"],
    urls: ["https://www.egova.com.cn/Web/images/favicon.png"]
  }
];

const knownDomainLogoUrls = new Map<string, string[]>([
  ["chinadep.com", ["https://www.google.com/s2/favicons?domain=chinadep.com&sz=128"]],
  [
    "csnwd.com.cn",
    [
      "https://images.weserv.nl/?url=www.csnwd.com.cn/images/202106-nsbd-logo.png"
    ]
  ],
  ["sensetime.com", ["https://static.sensetime.com/images/st_logo_ico.png"]]
]);

const companyLogoSourceByKey = new Map<string, CompanyLogoSource>();

knownCompanyLogoSources.forEach((source) => {
  source.keys.forEach((key) => {
    const normalizedKey = normalizeCompanyLookupKey(key);
    if (normalizedKey && !companyLogoSourceByKey.has(normalizedKey)) {
      companyLogoSourceByKey.set(normalizedKey, source);
    }
  });
});

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

export function getCompanyLogoCandidates(company: CompanyWithLogo) {
  const mappedSources = getMappedCompanyLogoSources(company);
  const mappedUrls = mappedSources.flatMap((source) => source.urls ?? []).map(normalizeLogoUrl);
  const mappedDomainUrls = mappedSources.flatMap((source) => source.domains ?? []).flatMap(getDomainLogoCandidates);
  const reportLogoUrl = normalizeLogoUrl(company.logoUrl);
  const reportDomainUrls = getDomainLogoCandidates(company.logoDomain);
  const candidates = [...mappedUrls, ...mappedDomainUrls, reportLogoUrl, ...reportDomainUrls];

  return Array.from(new Set(candidates.filter(isDefined)));
}

function getMappedCompanyLogoSources(company: CompanyWithLogo) {
  const sources: CompanyLogoSource[] = [];

  getCompanyLookupKeys(company).forEach((key) => {
    const source = companyLogoSourceByKey.get(normalizeCompanyLookupKey(key));
    if (source && !sources.includes(source)) {
      sources.push(source);
    }
  });

  return sources;
}

function getCompanyLookupKeys(company: CompanyWithLogo) {
  const ticker = company.ticker.trim();
  const tickerParts = ticker.split(/[\/,，;；|\s]+/).filter(Boolean);

  return [company.id, company.name, ticker, ...tickerParts].filter(Boolean);
}

function getDomainLogoCandidates(value: string | undefined) {
  const domain = normalizeLogoDomain(value);
  if (!domain) return [];
  const hosts = getDomainHostVariants(domain);
  const knownUrls = knownDomainLogoUrls.get(domain) ?? [];
  const hostAssetUrls = hosts.flatMap((host) => [
    `https://${host}/favicon.ico`
  ]);
  const proxyUrls = hosts.flatMap((host) => [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${host}.ico`
  ]);

  return [...knownUrls, ...hostAssetUrls, ...proxyUrls];
}

function getDomainHostVariants(domain: string) {
  if (domain.startsWith("www.")) return [domain, domain.replace(/^www\./i, "")];

  return [domain, `www.${domain}`];
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

function normalizeCompanyLookupKey(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[（）()]/g, "").replace(/\s+/g, "") ?? "";
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
