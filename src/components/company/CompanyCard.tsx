import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Building2 } from "lucide-react";
import type { Company } from "../../data/policy";
import { CompanyTag } from "./CompanyTag";
import {
  clampScore,
  cx,
  getCompanyLogoCandidates,
  getCompanyName,
  type CompanyWithLogo
} from "./companyUtils";

type LogoVariant = "card" | "hero" | "matrix";

const logoVariantStyles: Record<LogoVariant, CSSProperties> = {
  card: {},
  hero: { width: 52, height: 52, flex: "0 0 auto", fontSize: 16 },
  matrix: { width: 18, height: 18, flex: "0 0 auto", fontSize: 9 }
};

const logoPlaceholderIconSizes: Record<LogoVariant, number> = {
  card: 20,
  hero: 28,
  matrix: 12
};

const logoImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "block",
  objectFit: "contain",
  borderRadius: "inherit",
  position: "relative",
  zIndex: 1
};

const cardShellStyle: CSSProperties = {
  height: "100%",
  gridTemplateColumns: "1fr",
  gridTemplateRows: "auto auto minmax(58px, 1fr) auto",
  alignContent: "stretch"
};

const cardHeaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: 10,
  alignItems: "center",
  minWidth: 0
};

const cardTitleStyle: CSSProperties = { minWidth: 0, overflowWrap: "anywhere" };
const cardTagsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0 };

function createReasonStyle(compact?: boolean): CSSProperties {
  return {
    minHeight: compact ? 46 : 58,
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: compact ? 3 : 4,
    overflow: "hidden"
  };
}

export function CompanyLogo({
  company,
  variant = "card",
  className
}: {
  company: CompanyWithLogo;
  variant?: LogoVariant;
  className?: string;
}) {
  const logoCandidates = useMemo(
    () => getCompanyLogoCandidates(company),
    [company.id, company.name, company.ticker, company.logoDomain, company.logoUrl]
  );
  const logoKey = `${company.id}:${logoCandidates.join("|")}`;
  const [logoIndex, setLogoIndex] = useState(0);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const currentLogo = logoCandidates[logoIndex];
  const companyName = getCompanyName(company);
  const label = `${companyName} 标识`;
  const fallbackLabel = `${companyName} 标识暂不可用`;

  useEffect(() => {
    setLogoIndex(0);
    setLogoLoaded(false);
  }, [logoKey]);

  useEffect(() => {
    setLogoLoaded(false);
  }, [currentLogo]);

  useEffect(() => {
    if (!currentLogo || logoLoaded) return;

    const timeout = window.setTimeout(() => {
      setLogoIndex((index) => {
        if (logoCandidates[index] !== currentLogo) return index;
        return Math.min(index + 1, logoCandidates.length);
      });
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [currentLogo, logoCandidates, logoLoaded]);

  function advanceLogoCandidate() {
    setLogoLoaded(false);
    setLogoIndex((index) => Math.min(index + 1, logoCandidates.length));
  }

  return (
    <span
      className={cx(
        "company-logo",
        `company-logo-${variant}`,
        currentLogo ? "has-image" : "fallback",
        currentLogo && !logoLoaded && "loading",
        currentLogo && logoLoaded && "loaded",
        className
      )}
      style={logoVariantStyles[variant]}
      role={currentLogo ? undefined : "img"}
      aria-label={currentLogo ? undefined : fallbackLabel}
      title={companyName}
    >
      {currentLogo ? (
        <>
          {!logoLoaded && (
            <Building2
              className="company-logo-pending"
              size={logoPlaceholderIconSizes[variant]}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          )}
          <img
            src={currentLogo}
            alt={label}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            style={logoImageStyle}
            onLoad={() => setLogoLoaded(true)}
            onError={advanceLogoCandidate}
          />
        </>
      ) : (
        <Building2 size={logoPlaceholderIconSizes[variant]} strokeWidth={1.8} aria-hidden="true" />
      )}
    </span>
  );
}

export function CompanyCard({ company, compact }: { company: Company; compact?: boolean }) {
  const companyWithLogo = company as CompanyWithLogo;
  const companyName = getCompanyName(company);
  const ticker = company.ticker.trim() || "代码未标注";
  const platform = company.platform.trim() || "未标注业务";
  const reason = company.reason.trim() || platform;
  const confidence = clampScore(company.confidence);
  const policyRelevance = clampScore(company.policyRelevance);
  const evidenceCount = Number.isFinite(company.evidenceCount) ? Math.max(0, Math.round(company.evidenceCount)) : 0;

  return (
    <article className={cx("company-card", "company-card-stable", compact && "compact")} style={cardShellStyle}>
      <header className="company-card-header" style={cardHeaderStyle}>
        <CompanyLogo company={companyWithLogo} />
        <div className="company-card-title" style={cardTitleStyle}>
          <strong>{companyName}</strong>
          <span>{ticker} · {platform}</span>
        </div>
      </header>
      <section className="company-card-tags" style={cardTagsStyle} aria-label="公司影响标签">
        <CompanyTag value={company.relation} small />
        <CompanyTag value={company.evidence} small />
      </section>
      <p className="company-card-reason" style={createReasonStyle(compact)}>{reason}</p>
      <footer className="company-card-bottom company-card-metrics">
        <span className="company-card-evidence">证据 {evidenceCount} 条</span>
        <span className="company-card-relevance">相关 {policyRelevance}</span>
        <b className="company-card-score">{confidence}/100</b>
      </footer>
    </article>
  );
}
