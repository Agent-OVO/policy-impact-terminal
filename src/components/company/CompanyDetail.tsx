import { ChevronRight, X } from "lucide-react";
import type { ChainNode, Clause, Company, Evidence } from "../../data/policy";
import { CompanyTag } from "./CompanyTag";
import { companySectionLabels } from "./companyConstants";
import { getNodeById, isDefined } from "./companyUtils";

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
  const resetCompanyId = companies[0]?.id ?? selectedCompany.id;

  return (
    <aside className="panel company-detail">
      <div className="company-detail-hero">
        <span>公司详情</span>
        <div className="row-between">
          <h2>{selectedCompany.name}</h2>
          <button className="icon-button quiet" onClick={() => setSelectedCompanyId(resetCompanyId)} aria-label="重置公司选择">
            <X size={16} />
          </button>
        </div>
        <p>{selectedCompany.ticker} · {selectedCompany.status}</p>
        <div className="company-scoreline">
          <strong>{selectedCompany.confidence}<small>/100</small></strong>
          <i><b style={{ width: `${selectedCompany.confidence}%` }} /></i>
        </div>
        <div className="tag-row">
          <CompanyTag value={selectedCompany.relation} />
          <CompanyTag value={selectedCompany.evidence} />
        </div>
      </div>
      <dl className="company-facts">
        <div><dt>证据数量</dt><dd>{selectedCompany.evidenceCount} 条</dd></div>
        <div><dt>政策相关度</dt><dd>{selectedCompany.policyRelevance}/100</dd></div>
        <div><dt>证据确定性</dt><dd>{selectedCompany.evidenceCertainty}/100</dd></div>
        <div><dt>产业环节</dt><dd>{companySectionLabels[selectedCompany.section]}</dd></div>
        <div><dt>主要映射</dt><dd>{selectedCompany.platform}</dd></div>
      </dl>
      <section>
        <h3>为什么纳入本政策分析</h3>
        <p>{selectedCompany.reason}</p>
      </section>
      <section>
        <h3>映射路径</h3>
        <div className="company-path">
          <span>政策条款</span>
          {selectedClauses.map((clause) => <b key={clause.id}>{clause.no}</b>)}
          <ChevronRight size={14} />
          {selectedNodes.map((node) => <b key={node.id}>{node.title}</b>)}
          <ChevronRight size={14} />
          <strong>{selectedCompany.name}</strong>
        </div>
      </section>
      <section>
        <h3>关键证据</h3>
        <div className="company-evidence-list">
          {selectedEvidence.map((item) => (
            <article key={item.id}>
              <span>{item.type} · {item.source}</span>
              <p>{item.excerpt}</p>
            </article>
          ))}
        </div>
      </section>
      <section>
        <h3>关联产业环节</h3>
        <div className="tag-row">
          <span>{companySectionLabels[selectedCompany.section]}</span>
          {selectedCompany.products.map((product) => <span key={product}>{product}</span>)}
        </div>
      </section>
      <section>
        <h3>本次分析不确定点</h3>
        <p>{selectedCompany.uncertainty}</p>
      </section>
    </aside>
  );
}
