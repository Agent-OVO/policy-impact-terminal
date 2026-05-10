import { useState } from "react";
import { Search } from "lucide-react";
import { companies } from "../../data/policy";
import { CompanyCard } from "./CompanyCard";
import { CompanyDetail } from "./CompanyDetail";
import { CompanyMatrix } from "./CompanyMatrix";
import { companySectionLabels, companySectionOrder } from "./companyConstants";
import { cx, getCompanyById } from "./companyUtils";

export function CompaniesView() {
  const [selectedCompanyId, setSelectedCompanyId] = useState(companies[0].id);
  const selected = getCompanyById(selectedCompanyId) || companies[0];
  const grouped = companySectionOrder.map((section) => ({
    section,
    items: companies.filter((company) => company.section === section)
  }));

  return (
    <div className="companies-layout">
      <section className="panel company-matrix-panel">
        <div className="panel-head">
          <h2>代表性公司影响分析</h2>
          <p>仅服务于本次政策分析，不做公司持续跟踪。</p>
        </div>
        <CompanyMatrix selectedCompanyId={selectedCompanyId} setSelectedCompanyId={setSelectedCompanyId} />
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
                  <button key={company.id} className={cx(selectedCompanyId === company.id && "active")} onClick={() => setSelectedCompanyId(company.id)}>
                    <CompanyCard company={company} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <CompanyDetail selectedCompany={selected} setSelectedCompanyId={setSelectedCompanyId} />
    </div>
  );
}
