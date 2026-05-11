import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { chainNodes as defaultChainNodes, clauses as defaultClauses, companies as defaultCompanies, evidence as defaultEvidence } from "../../data/policy";
import type { ChainNode, Clause, Company, Evidence } from "../../data/policy";
import { CompanyCard } from "./CompanyCard";
import { CompanyDetail } from "./CompanyDetail";
import { CompanyMatrix } from "./CompanyMatrix";
import { companySectionLabels, companySectionOrder } from "./companyConstants";
import { cx, getCompanyById } from "./companyUtils";

export function CompaniesView({
  chainNodes = defaultChainNodes,
  clauses = defaultClauses,
  companies = defaultCompanies,
  evidence = defaultEvidence,
  onCompanySelect
}: {
  chainNodes?: ChainNode[];
  clauses?: Clause[];
  companies?: Company[];
  evidence?: Evidence[];
  onCompanySelect?: (companyId: string, source?: string) => void;
}) {
  const [selectedCompanyId, setSelectedCompanyId] = useState(companies[0]?.id ?? "");
  const selected = getCompanyById(selectedCompanyId, companies) || companies[0];
  const grouped = companySectionOrder.map((section) => ({
    section,
    items: companies.filter((company) => company.section === section)
  }));

  useEffect(() => {
    if (!companies.some((company) => company.id === selectedCompanyId)) {
      setSelectedCompanyId(companies[0]?.id ?? "");
    }
  }, [companies, selectedCompanyId]);

  function selectCompany(companyId: string, source = "company_cards") {
    setSelectedCompanyId(companyId);
    onCompanySelect?.(companyId, source);
  }

  if (!selected) {
    return (
      <div className="companies-layout">
        <section className="panel company-matrix-panel">
          <div className="panel-head">
            <h2>代表性公司影响分析</h2>
            <p>当前自动分析尚未生成公司映射，后续接入公司库后会补充。</p>
          </div>
          <CompanyMatrix companies={[]} />
        </section>
      </div>
    );
  }

  return (
    <div className="companies-layout">
      <section className="panel company-matrix-panel">
        <div className="panel-head">
          <h2>代表性公司影响分析</h2>
          <p>仅服务于本次政策分析，不做公司持续跟踪。</p>
        </div>
        <CompanyMatrix companies={companies} selectedCompanyId={selectedCompanyId} setSelectedCompanyId={(id) => selectCompany(id, "company_matrix")} />
      </section>
      <section className="panel company-cards-panel">
        <div className="panel-head">
          <h2>按产业链环节查看</h2>
          <div className="input-shell slim"><Search size={15} /><input placeholder="搜索公司、平台、环节" /></div>
        </div>
        <div className="company-groups">
          {grouped.map(({ section, items }) => (
            <div key={section} className="company-group">
              <h3>{companySectionLabels[section]} <span>相关公司 {items.length} 家</span></h3>
              <div className="company-grid">
                {items.map((company) => (
                  <button key={company.id} className={cx(selectedCompanyId === company.id && "active")} onClick={() => selectCompany(company.id, "company_cards")}>
                    <CompanyCard company={company} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <CompanyDetail
        chainNodes={chainNodes}
        clauses={clauses}
        evidence={evidence}
        companies={companies}
        selectedCompany={selected}
        setSelectedCompanyId={(id) => selectCompany(id, "company_detail")}
      />
    </div>
  );
}
