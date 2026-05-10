import { companies as defaultCompanies } from "../../data/policy";
import type { Company } from "../../data/policy";
import { companyMatrixOffsets, companyRelationClass } from "./companyConstants";
import { clamp, cx, getCompanyById } from "./companyUtils";

export function CompanyMatrix({
  compact,
  companies = defaultCompanies,
  selectedCompanyId,
  setSelectedCompanyId
}: {
  compact?: boolean;
  companies?: Company[];
  selectedCompanyId?: string;
  setSelectedCompanyId?: (id: string) => void;
}) {
  if (companies.length === 0) {
    return (
      <div className={cx("company-matrix", compact && "compact", "empty")}>
        <div className="matrix-plot-label">
          <strong>公司影响象限</strong>
          <span>当前自动分析尚未生成公司映射</span>
        </div>
      </div>
    );
  }

  const selected = getCompanyById(selectedCompanyId || companies[0].id, companies) || companies[0];

  return (
    <div className={cx("company-matrix", compact && "compact")}>
      <div className="matrix-plot-label">
        <strong>公司影响象限</strong>
        <span>横轴政策相关度，纵轴证据确定性</span>
      </div>
      <div className="matrix-quadrant high-high">优先解读</div>
      <div className="matrix-quadrant high-low">重点验证</div>
      <div className="matrix-quadrant low-high">配套观察</div>
      <div className="matrix-quadrant low-low">弱相关</div>
      <div className="axis y">证据确定性</div>
      <div className="axis x">政策相关度</div>
      {companies.map((company, index) => {
        const [offsetX, offsetY] = companyMatrixOffsets[index % companyMatrixOffsets.length];
        const active = selectedCompanyId === company.id;
        const showLabel = compact ? active : true;
        const left = clamp(company.policyRelevance + offsetX, 14, 88);
        const bottom = clamp(company.evidenceCertainty + offsetY, 16, 84);

        return (
          <button
            key={company.id}
            style={{
              left: `${left}%`,
              bottom: `${bottom}%`
            }}
            className={cx(active && "active", showLabel && "with-label", companyRelationClass[company.relation])}
            onClick={() => setSelectedCompanyId?.(company.id)}
            aria-label={`${company.name}，政策相关度 ${company.policyRelevance}，证据确定性 ${company.evidenceCertainty}`}
            aria-pressed={active}
            title={`${company.name} · ${company.platform}`}
          >
            <span>{index + 1}</span>
            {showLabel && <em>{company.name}</em>}
          </button>
        );
      })}
      <div className="matrix-selected-label">
        <span>{selected.name}</span>
        <strong>{selected.policyRelevance}/{selected.evidenceCertainty}</strong>
      </div>
      <span className="axis-label low-x">低</span>
      <span className="axis-label high-x">高</span>
      <span className="axis-label low-y">低</span>
      <span className="axis-label high-y">高</span>
    </div>
  );
}
