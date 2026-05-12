import type { Company } from "../../data/policy";
import { companyMatrixOffsets, companyRelationClass } from "./companyConstants";
import { clamp, clampScore, cx, getCompanyById } from "./companyUtils";

export function CompanyMatrix({
  compact,
  companies = [],
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
      <div className={cx("company-matrix", compact && "compact", "empty")} role="status" aria-live="polite">
        <div className="matrix-plot-label">
          <strong>公司影响象限</strong>
          <span>当前人工分析尚未生成公司映射</span>
        </div>
        <div
          className="matrix-selected-label"
          style={{
            left: "50%",
            right: "auto",
            bottom: "50%",
            maxWidth: "calc(100% - 32px)",
            transform: "translate(-50%, 50%)",
            textAlign: "center"
          }}
        >
          <span style={{ overflowWrap: "anywhere" }}>暂无公司数据</span>
        </div>
      </div>
    );
  }

  const selected = getCompanyById(selectedCompanyId || companies[0].id, companies) || companies[0];
  const activeCompanyId = selected.id;

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
        const active = activeCompanyId === company.id;
        const showLabel = active || companies.length <= 5;
        const policyRelevance = clampScore(company.policyRelevance);
        const evidenceCertainty = clampScore(company.evidenceCertainty);
        const left = clamp(policyRelevance + offsetX, 14, 88);
        const bottom = clamp(evidenceCertainty + offsetY, 16, 84);
        const companyName = company.name.trim() || `公司 ${index + 1}`;
        const platform = company.platform.trim() || "未标注业务";

        return (
          <button
            type="button"
            key={company.id || `company-${index + 1}`}
            style={{
              left: `${left}%`,
              bottom: `${bottom}%`
            }}
            className={cx(active && "active", showLabel && "with-label", companyRelationClass[company.relation])}
            onClick={() => {
              if (company.id) setSelectedCompanyId?.(company.id);
            }}
            aria-label={`${companyName}，政策相关度 ${policyRelevance}，证据确定性 ${evidenceCertainty}`}
            aria-pressed={active}
            disabled={!setSelectedCompanyId || !company.id}
            title={`${companyName} · ${platform}`}
          >
            <span>{index + 1}</span>
            {showLabel && <em>{companyName}</em>}
          </button>
        );
      })}
      <div className="matrix-selected-label">
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected.name.trim() || "未命名公司"}
        </span>
        <strong>{clampScore(selected.policyRelevance)}/{clampScore(selected.evidenceCertainty)}</strong>
      </div>
      <span className="axis-label low-x">低</span>
      <span className="axis-label high-x">高</span>
      <span className="axis-label low-y">低</span>
      <span className="axis-label high-y">高</span>
    </div>
  );
}
