import type { CSSProperties } from "react";
import type { Company } from "../../data/policy";
import { CompanyLogo } from "./CompanyCard";
import { companyMatrixOffsets, companyRelationClass } from "./companyConstants";
import { clamp, clampScore, cx, getCompanyById, getCompanyName } from "./companyUtils";

const matrixSelectedCopyStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 2,
  overflow: "hidden"
};

const matrixSelectedNameStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const matrixSelectedMetaStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

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
  const selectedName = getCompanyName(selected);
  const selectedPlatform = selected.platform.trim() || "未标注业务";
  const selectedPolicyRelevance = clampScore(selected.policyRelevance);
  const selectedEvidenceCertainty = clampScore(selected.evidenceCertainty);

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
            className={cx(
              "company-matrix-point",
              active && "active",
              showLabel && "with-label",
              companyRelationClass[company.relation]
            )}
            onClick={() => {
              if (company.id) setSelectedCompanyId?.(company.id);
            }}
            aria-label={`${companyName}，${platform}，政策相关度 ${policyRelevance}，证据确定性 ${evidenceCertainty}`}
            aria-pressed={active}
            disabled={!setSelectedCompanyId || !company.id}
            title={`${companyName} · ${platform}`}
            data-policy-relevance={policyRelevance}
            data-evidence-certainty={evidenceCertainty}
          >
            <span className="matrix-marker-logo">
              <CompanyLogo company={company} variant="matrix" />
            </span>
            {showLabel && <em>{companyName}</em>}
            {active && <small className="matrix-point-metrics">{policyRelevance}/{evidenceCertainty}</small>}
          </button>
        );
      })}
      <div className="matrix-selected-label matrix-selected-card" role="status" aria-live="polite">
        <CompanyLogo company={selected} variant="matrix" />
        <span className="matrix-selected-copy" style={matrixSelectedCopyStyle}>
          <span style={matrixSelectedNameStyle}>{selectedName}</span>
          <small style={matrixSelectedMetaStyle}>{selectedPlatform}</small>
        </span>
        <strong aria-label={`政策相关度 ${selectedPolicyRelevance}，证据确定性 ${selectedEvidenceCertainty}`}>
          {selectedPolicyRelevance}/{selectedEvidenceCertainty}
        </strong>
      </div>
      <span className="axis-label low-x">低</span>
      <span className="axis-label high-x">高</span>
      <span className="axis-label low-y">低</span>
      <span className="axis-label high-y">高</span>
    </div>
  );
}
