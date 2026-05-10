import type { Company } from "../../data/policy";
import { CompanyTag } from "./CompanyTag";
import { cx } from "./companyUtils";

export function CompanyCard({ company, compact }: { company: Company; compact?: boolean }) {
  return (
    <article className={cx("company-card", compact && "compact")}>
      <div className="company-logo">{company.name.slice(0, 1)}</div>
      <div>
        <strong>{company.name}</strong>
        <span>{company.ticker}</span>
      </div>
      <CompanyTag value={company.relation} small />
      <CompanyTag value={company.evidence} small />
      <p>{company.platform}</p>
      <div className="company-card-bottom">
        <span>证据 {company.evidenceCount} 条</span>
        <b>{company.confidence}/100</b>
      </div>
    </article>
  );
}
