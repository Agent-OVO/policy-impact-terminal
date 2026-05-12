import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import type { ChainNode, Clause, Company, Evidence } from "../../data/policy";
import { CompanyCard } from "./CompanyCard";
import { CompanyDetail } from "./CompanyDetail";
import { CompanyMatrix } from "./CompanyMatrix";
import { companySectionLabels, companySectionOrder } from "./companyConstants";
import { cx, getCompanyById } from "./companyUtils";

function getCompanySearchText(company: Company) {
  return [
    company.name,
    company.ticker,
    company.platform,
    company.status,
    company.relation,
    company.evidence,
    company.reason,
    company.uncertainty,
    companySectionLabels[company.section],
    ...company.products
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function CompaniesView({
  chainNodes = [],
  clauses = [],
  companies = [],
  evidence = [],
  onCompanySelect
}: {
  chainNodes?: ChainNode[];
  clauses?: Clause[];
  companies?: Company[];
  evidence?: Evidence[];
  onCompanySelect?: (companyId: string, source?: string) => void;
}) {
  const [selectedCompanyId, setSelectedCompanyId] = useState(companies[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCompanies = normalizedQuery
    ? companies.filter((company) => getCompanySearchText(company).includes(normalizedQuery))
    : companies;
  const selected = getCompanyById(selectedCompanyId, companies) || companies[0];
  const activeCompanyId = selected?.id ?? "";
  const grouped = companySectionOrder
    .map((section) => ({
      section,
      items: filteredCompanies.filter((company) => company.section === section)
    }))
    .filter(({ items }) => items.length > 0);

  useEffect(() => {
    if (companies.length === 0) {
      if (selectedCompanyId !== "") setSelectedCompanyId("");
      return;
    }

    if (!companies.some((company) => company.id === selectedCompanyId)) {
      setSelectedCompanyId(companies[0]?.id ?? "");
    }
  }, [companies, selectedCompanyId]);

  function selectCompany(companyId: string, source = "company_cards") {
    if (!companies.some((company) => company.id === companyId)) return;
    setSelectedCompanyId(companyId);
    onCompanySelect?.(companyId, source);
  }

  if (companies.length === 0) {
    return (
      <div className="companies-layout">
        <section className="panel company-matrix-panel">
          <div className="panel-head">
            <h2>代表性公司影响分析</h2>
            <p>当前人工分析尚未生成公司映射。系统不会用样例公司填充，以免误导政策判断。</p>
          </div>
          <CompanyMatrix companies={[]} />
        </section>
        <section className="panel company-cards-panel" aria-live="polite">
          <div className="panel-head">
            <h2>公司映射列表</h2>
          </div>
          <p className="empty-note">暂无可查看的公司数据。需要后端分析结果返回公司映射后，才会展示列表、矩阵点位和详情。</p>
        </section>
        <aside className="panel company-detail" aria-live="polite">
          <div className="company-detail-hero">
            <span>公司详情</span>
            <h2 style={{ overflowWrap: "anywhere" }}>暂无公司映射</h2>
            <p>请选择包含公司级影响分析的报表。</p>
          </div>
        </aside>
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
        <CompanyMatrix companies={companies} selectedCompanyId={activeCompanyId} setSelectedCompanyId={(id) => selectCompany(id, "company_matrix")} />
      </section>
      <section className="panel company-cards-panel">
        <div className="panel-head">
          <h2>按产业链环节查看</h2>
          <div className="input-shell slim">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索公司、平台、环节"
              aria-label="搜索公司映射"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="清除公司搜索"
                title="清除搜索"
                style={{
                  width: 24,
                  height: 24,
                  flex: "0 0 auto",
                  display: "inline-grid",
                  placeItems: "center",
                  border: 0,
                  borderRadius: 999,
                  background: "transparent",
                  color: "inherit"
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="company-groups" aria-live="polite">
          {filteredCompanies.length === 0 ? (
            <div>
              <p className="empty-note">没有匹配的公司映射。</p>
              {query && (
                <button type="button" className="text-button" onClick={() => setQuery("")}>
                  <X size={14} /> 清除搜索
                </button>
              )}
            </div>
          ) : (
            grouped.map(({ section, items }) => (
              <div key={section} className="company-group">
                <h3 style={{ overflowWrap: "anywhere" }}>
                  {companySectionLabels[section]} <span>相关公司 {items.length} 家</span>
                </h3>
                <div className="company-grid">
                  {items.map((company, index) => {
                    const companyName = company.name.trim() || `公司 ${index + 1}`;

                    return (
                      <button
                        type="button"
                        key={company.id || `${section}-${index}`}
                        className={cx(activeCompanyId === company.id && "active")}
                        onClick={() => selectCompany(company.id, "company_cards")}
                        aria-label={`查看 ${companyName} 的公司影响详情`}
                        aria-pressed={activeCompanyId === company.id}
                        disabled={!company.id}
                        style={{ minWidth: 0, overflowWrap: "anywhere" }}
                      >
                        <CompanyCard company={company} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
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
