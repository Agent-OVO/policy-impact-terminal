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
const boundaryNoticeStyle: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  border: "1px dashed rgba(245, 158, 11, 0.55)",
  borderRadius: 12,
  background: "rgba(245, 158, 11, 0.08)",
  color: "inherit"
};

function textOrFallback(value: string | undefined, fallback: string) {
  const normalized = value?.trim() ?? "";
  return normalized || fallback;
}

function buildBoundaryNotice(company: Company) {
  if (company.officialMention && company.evidence === "强证据") {
    return "该主体与政策文本存在较强对应关系，但仍需结合后续项目、采购、预算或经营数据验证实际影响。";
  }
  if (company.evidence === "待验证") {
    return "该主体当前仅作为低置信观察线索，政策未点名，暂未形成订单、采购、补贴或业绩影响证据。";
  }
  return "该主体未被政策点名，当前仅为产业链相关观察；具体影响需等待地方项目、预算、招投标或配套细则验证。";
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
  const rawTicker = selectedCompany.ticker.trim();
  const ticker = /^(未上市|非上市|未标注|代码未标注|N\/A|无|-)$/i.test(rawTicker)
    ? "代码未标注"
    : textOrFallback(rawTicker, "代码未标注");
  const entityType = textOrFallback(selectedCompany.entityType, "企业主体");
  const listingStatus = textOrFallback(
    selectedCompany.listingStatus,
    ticker === "代码未标注" ? rawTicker || "非上市或代码未标注" : "上市/挂牌主体"
  );
  const selectionBasis = textOrFallback(selectedCompany.selectionBasis, selectedCompany.officialMention ? "官方文件点名或附件列示" : "按政策产业链关联选择");
  const confidence = clampScore(selectedCompany.confidence);
  const boundaryNotice = buildBoundaryNotice(selectedCompany);
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
          {!selectedCompany.officialMention && <span className="tag">未被政策点名</span>}
        </div>
        <div style={boundaryNoticeStyle}>
          <strong>映射边界：</strong>
          <span style={wrapTextStyle}>{boundaryNotice}</span>
        </div>
      </div>
      <dl className="company-facts">
        <div><dt>证据数量</dt><dd style={wrapTextStyle}>{evidenceCount} 条</dd></div>
        <div><dt>政策相关度</dt><dd style={wrapTextStyle}>{clampScore(selectedCompany.policyRelevance)}/100</dd></div>
        <div><dt>证据确定性</dt><dd style={wrapTextStyle}>{clampScore(selectedCompany.evidenceCertainty)}/100</dd></div>
        <div><dt>主体类型</dt><dd style={wrapTextStyle}>{entityType}</dd></div>
        <div><dt>上市状态</dt><dd style={wrapTextStyle}>{listingStatus}</dd></div>
        <div><dt>纳入依据</dt><dd style={wrapTextStyle}>{selectionBasis}</dd></div>
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
