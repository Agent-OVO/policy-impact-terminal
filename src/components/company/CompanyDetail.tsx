import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ChainNode, Clause, Company, Evidence } from "../../data/policy";
import { CompanyLogo } from "./CompanyCard";
import { CompanyTag } from "./CompanyTag";
import { companySectionLabels } from "./companyConstants";
import { clampScore, getNodeById, isDefined } from "./companyUtils";

const wrapTextStyle: CSSProperties = { minWidth: 0, overflowWrap: "anywhere" };
const detailButtonGroupStyle: CSSProperties = { display: "inline-flex", gap: 6, flexShrink: 0 };
const detailHeroHeadStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 12,
  alignItems: "start",
  minWidth: 0
};
const detailIdentityStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: 12,
  alignItems: "center",
  minWidth: 0
};
const detailTitleStyle: CSSProperties = { display: "grid", gap: 4, minWidth: 0 };

function textOrFallback(value: string, fallback: string) {
  const normalized = value.trim();
  return normalized || fallback;
}

export function CompanyDetail({
  chainNodes,
  clauses,
  evidence,
  companies,
  selectedCompany,
  setSelectedCompanyId
}: {
  chainNodes: ChainNode[];
  clauses: Clause[];
  evidence: Evidence[];
  companies: Company[];
  selectedCompany: Company;
  setSelectedCompanyId: (id: string) => void;
}) {
  const selectedClauses = selectedCompany.clauseIds
    .map((id) => clauses.find((clause) => clause.id === id))
    .filter(isDefined);
  const selectedEvidence = selectedCompany.evidenceIds.map((id) => evidence.find((item) => item.id === id)).filter(isDefined);
  const selectedNodes = selectedCompany.nodeIds.map((id) => getNodeById(id, chainNodes)).filter(isDefined) as ChainNode[];
  const selectedIndex = companies.findIndex((company) => company.id === selectedCompany.id);
  const canSwitchCompanies = companies.length > 1 && selectedIndex >= 0;
  const previousCompany = canSwitchCompanies ? companies[(selectedIndex - 1 + companies.length) % companies.length] : undefined;
  const nextCompany = canSwitchCompanies ? companies[(selectedIndex + 1) % companies.length] : undefined;
  const resetCompanyId = companies[0]?.id ?? selectedCompany.id;
  const companyName = textOrFallback(selectedCompany.name, "未命名公司");
  const platform = textOrFallback(selectedCompany.platform, "未标注业务");
  const status = textOrFallback(selectedCompany.status, "状态未标注");
  const ticker = textOrFallback(selectedCompany.ticker, "代码未标注");
  const confidence = clampScore(selectedCompany.confidence);
  const evidenceCount = Number.isFinite(selectedCompany.evidenceCount)
    ? Math.max(0, Math.round(selectedCompany.evidenceCount))
    : selectedEvidence.length;

  function selectDetailCompany(company?: Company) {
    if (company?.id) setSelectedCompanyId(company.id);
  }

  return (
    <aside className="panel company-detail">
      <div className="company-detail-hero">
        <div className="company-detail-hero-head" style={detailHeroHeadStyle}>
          <div className="company-detail-identity" style={detailIdentityStyle}>
            <CompanyLogo company={selectedCompany} variant="hero" />
            <div className="company-detail-title" style={detailTitleStyle}>
              <span className="company-detail-kicker">公司详情</span>
              <h2 style={wrapTextStyle}>{companyName}</h2>
              <p style={wrapTextStyle}>{ticker} · {status}</p>
            </div>
          </div>
          <div style={detailButtonGroupStyle}>
            <button
              type="button"
              className="icon-button quiet"
              onClick={() => selectDetailCompany(previousCompany)}
              disabled={!previousCompany}
              aria-label="上一家公司"
              title="上一家公司"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="icon-button quiet"
              onClick={() => selectDetailCompany(nextCompany)}
              disabled={!nextCompany}
              aria-label="下一家公司"
              title="下一家公司"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              className="icon-button quiet"
              onClick={() => setSelectedCompanyId(resetCompanyId)}
              disabled={!resetCompanyId || resetCompanyId === selectedCompany.id}
              aria-label="重置公司选择"
              title="回到第一家公司"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="company-scoreline">
          <strong>{confidence}<small>/100</small></strong>
          <i><b style={{ width: `${confidence}%` }} /></i>
        </div>
        <div className="tag-row">
          <CompanyTag value={selectedCompany.relation} />
          <CompanyTag value={selectedCompany.evidence} />
        </div>
      </div>
      <dl className="company-facts">
        <div><dt>证据数量</dt><dd style={wrapTextStyle}>{evidenceCount} 条</dd></div>
        <div><dt>政策相关度</dt><dd style={wrapTextStyle}>{clampScore(selectedCompany.policyRelevance)}/100</dd></div>
        <div><dt>证据确定性</dt><dd style={wrapTextStyle}>{clampScore(selectedCompany.evidenceCertainty)}/100</dd></div>
        <div><dt>产业环节</dt><dd style={wrapTextStyle}>{companySectionLabels[selectedCompany.section]}</dd></div>
        <div><dt>主要映射</dt><dd style={wrapTextStyle}>{platform}</dd></div>
      </dl>
      <section>
        <h3>为什么纳入本政策分析</h3>
        <p style={wrapTextStyle}>{textOrFallback(selectedCompany.reason, "当前分析未给出明确纳入理由。")}</p>
      </section>
      <section>
        <h3>映射路径</h3>
        <div className="company-path" style={wrapTextStyle}>
          <span>政策条款</span>
          {selectedClauses.length > 0
            ? selectedClauses.map((clause) => <b key={clause.id} style={wrapTextStyle}>{clause.no}</b>)
            : <b style={wrapTextStyle}>未关联条款</b>}
          <ChevronRight size={14} aria-hidden="true" />
          {selectedNodes.length > 0
            ? selectedNodes.map((node) => <b key={node.id} style={wrapTextStyle}>{node.title}</b>)
            : <b style={wrapTextStyle}>未关联环节</b>}
          <ChevronRight size={14} aria-hidden="true" />
          <strong style={wrapTextStyle}>{companyName}</strong>
        </div>
      </section>
      <section>
        <h3>关键证据</h3>
        {selectedEvidence.length > 0 ? (
          <div className="company-evidence-list">
            {selectedEvidence.map((item) => (
              <article key={item.id} style={wrapTextStyle}>
                <span style={wrapTextStyle}>{item.type} · {item.source}</span>
                <p style={wrapTextStyle}>{item.excerpt}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-note">暂无逐条证据映射。为避免误导，不展示替代证据。</p>
        )}
      </section>
      <section>
        <h3>关联产业环节</h3>
        <div className="tag-row">
          <span style={wrapTextStyle}>{companySectionLabels[selectedCompany.section]}</span>
          {selectedCompany.products.length > 0
            ? selectedCompany.products.map((product) => <span key={product} style={wrapTextStyle}>{product}</span>)
            : <span style={wrapTextStyle}>未标注细分产品</span>}
        </div>
      </section>
      <section>
        <h3>本次分析不确定点</h3>
        <p style={wrapTextStyle}>{textOrFallback(selectedCompany.uncertainty, "当前分析未标注额外不确定点。")}</p>
      </section>
    </aside>
  );
}
