export type AnalyticsTrendPoint = {
  id?: string;
  label?: string;
  date: string;
  value: number;
  uniqueUsers?: number;
  sessions?: number;
};

export type AnalyticsRankedMetric = {
  id: string;
  label: string;
  value: number;
  helper?: string;
};

export type AnalyticsDistributionMetric = {
  id: string;
  label: string;
  value: number;
  percentage?: number;
  helper?: string;
};

export type AnalyticsChartsProps = {
  trend?: AnalyticsTrendPoint[];
  topPolicies?: AnalyticsRankedMetric[];
  moduleDistribution?: AnalyticsDistributionMetric[];
  eventDistribution?: AnalyticsDistributionMetric[];
};

const CHART_WIDTH = 680;
const LINE_CHART_HEIGHT = 240;
const BAR_CHART_WIDTH = 680;

function finiteNumber(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function positiveMetric(value: number | undefined) {
  return Math.max(0, finiteNumber(value));
}

function formatMetric(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatShare(value: number) {
  return `${Math.round(value)}%`;
}

function truncateLabel(value: string, length = 18) {
  const text = value.trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1)}...`;
}

function getDistributionPercentage(item: AnalyticsDistributionMetric, total: number) {
  if (typeof item.percentage === "number" && Number.isFinite(item.percentage)) {
    return Math.max(0, Math.min(100, item.percentage));
  }

  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (positiveMetric(item.value) / total) * 100));
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="admin-analytics-chart-empty" role="status">
      {label}
    </div>
  );
}

function TrendLineChart({ points }: { points: AnalyticsTrendPoint[] }) {
  if (points.length === 0) return <EmptyChart label="暂无趋势数据" />;

  const padding = { top: 18, right: 20, bottom: 42, left: 54 };
  const innerWidth = CHART_WIDTH - padding.left - padding.right;
  const innerHeight = LINE_CHART_HEIGHT - padding.top - padding.bottom;
  const values = points.map((point) => positiveMetric(point.value));
  const maxValue = Math.max(1, ...values);
  const xForIndex = (index: number) => padding.left + (points.length === 1 ? innerWidth / 2 : (innerWidth * index) / (points.length - 1));
  const yForValue = (value: number) => padding.top + innerHeight - (positiveMetric(value) / maxValue) * innerHeight;
  const polylinePoints = points.map((point, index) => `${xForIndex(index)},${yForValue(point.value)}`).join(" ");
  const areaPath =
    points.length === 1
      ? ""
      : [
          `M ${padding.left} ${padding.top + innerHeight}`,
          ...points.map((point, index) => `L ${xForIndex(index)} ${yForValue(point.value)}`),
          `L ${padding.left + innerWidth} ${padding.top + innerHeight}`,
          "Z"
        ].join(" ");
  const labelIndexes = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])).filter((index) => index >= 0);
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg
      className="admin-analytics-line-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${LINE_CHART_HEIGHT}`}
      role="img"
      aria-label="用户行为趋势折线图"
    >
      {gridLines.map((ratio) => {
        const y = padding.top + innerHeight - innerHeight * ratio;
        const value = Math.round(maxValue * ratio);

        return (
          <g key={ratio} className="admin-analytics-line-grid">
            <line x1={padding.left} x2={padding.left + innerWidth} y1={y} y2={y} />
            <text x={padding.left - 10} y={y + 4} textAnchor="end">
              {formatMetric(value)}
            </text>
          </g>
        );
      })}
      {areaPath && <path className="admin-analytics-line-area" d={areaPath} />}
      {points.length > 1 && <polyline className="admin-analytics-line-path" points={polylinePoints} fill="none" />}
      {points.map((point, index) => (
        <g key={point.id ?? `${point.date}-${index}`} className="admin-analytics-line-point">
          <circle cx={xForIndex(index)} cy={yForValue(point.value)} r={4} />
          <title>{`${point.label ?? point.date}: ${formatMetric(point.value)}`}</title>
        </g>
      ))}
      {labelIndexes.map((index) => {
        const point = points[index];

        return (
          <text key={point.id ?? point.date} className="admin-analytics-axis-label" x={xForIndex(index)} y={LINE_CHART_HEIGHT - 12} textAnchor="middle">
            {truncateLabel(point.label ?? point.date, 12)}
          </text>
        );
      })}
    </svg>
  );
}

function TopPolicyBarChart({ items }: { items: AnalyticsRankedMetric[] }) {
  if (items.length === 0) return <EmptyChart label="暂无政策排行数据" />;

  const rowHeight = 38;
  const padding = { top: 12, right: 76, bottom: 12, left: 178 };
  const chartHeight = Math.max(176, padding.top + padding.bottom + items.length * rowHeight);
  const innerWidth = BAR_CHART_WIDTH - padding.left - padding.right;
  const maxValue = Math.max(1, ...items.map((item) => positiveMetric(item.value)));

  return (
    <svg className="admin-analytics-bar-chart" viewBox={`0 0 ${BAR_CHART_WIDTH} ${chartHeight}`} role="img" aria-label="Top 政策条形图">
      {items.map((item, index) => {
        const y = padding.top + index * rowHeight;
        const barWidth = (positiveMetric(item.value) / maxValue) * innerWidth;

        return (
          <g key={item.id || `${item.label}-${index}`} className="admin-analytics-bar-row">
            <text className="admin-analytics-bar-label" x={padding.left - 14} y={y + 21} textAnchor="end">
              {truncateLabel(item.label, 22)}
            </text>
            <rect className="admin-analytics-bar-track" x={padding.left} y={y + 6} width={innerWidth} height={16} rx={8} />
            <rect className="admin-analytics-bar-fill" x={padding.left} y={y + 6} width={Math.max(2, barWidth)} height={16} rx={8} />
            <text className="admin-analytics-bar-value" x={padding.left + innerWidth + 14} y={y + 21}>
              {formatMetric(item.value)}
            </text>
            <title>{`${item.label}: ${formatMetric(item.value)}${item.helper ? `, ${item.helper}` : ""}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

function DistributionList({ title, items }: { title: string; items: AnalyticsDistributionMetric[] }) {
  if (items.length === 0) {
    return (
      <div className="admin-analytics-distribution-group">
        <h3 className="admin-analytics-chart-subtitle">{title}</h3>
        <EmptyChart label="暂无分布数据" />
      </div>
    );
  }

  const total = items.reduce((sum, item) => sum + positiveMetric(item.value), 0);

  return (
    <div className="admin-analytics-distribution-group">
      <h3 className="admin-analytics-chart-subtitle">{title}</h3>
      <div className="admin-analytics-distribution-list">
        {items.map((item, index) => {
          const percentage = getDistributionPercentage(item, total);

          return (
            <div className="admin-analytics-distribution-item" key={item.id || `${item.label}-${index}`}>
              <div className="admin-analytics-distribution-copy">
                <span className="admin-analytics-distribution-label">{item.label}</span>
                <strong className="admin-analytics-distribution-value">{formatMetric(item.value)}</strong>
              </div>
              <svg className="admin-analytics-distribution-meter" viewBox="0 0 160 12" aria-hidden="true">
                <rect className="admin-analytics-distribution-track" x="0" y="2" width="160" height="8" rx="4" />
                <rect className="admin-analytics-distribution-fill" x="0" y="2" width={(160 * percentage) / 100} height="8" rx="4" />
              </svg>
              <span className="admin-analytics-distribution-share">{formatShare(percentage)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AnalyticsCharts({
  trend = [],
  topPolicies = [],
  moduleDistribution = [],
  eventDistribution = []
}: AnalyticsChartsProps) {
  return (
    <section className="admin-analytics-charts" aria-label="行为分析图表">
      <article className="admin-analytics-chart-panel admin-analytics-chart-panel-trend">
        <div className="admin-analytics-chart-head">
          <h2 className="admin-analytics-chart-title">趋势折线</h2>
          <p className="admin-analytics-chart-note">事件量随时间变化</p>
        </div>
        <TrendLineChart points={trend} />
      </article>

      <article className="admin-analytics-chart-panel admin-analytics-chart-panel-policies">
        <div className="admin-analytics-chart-head">
          <h2 className="admin-analytics-chart-title">Top 政策</h2>
          <p className="admin-analytics-chart-note">按访问或交互次数排序</p>
        </div>
        <TopPolicyBarChart items={topPolicies} />
      </article>

      <article className="admin-analytics-chart-panel admin-analytics-chart-panel-distribution">
        <div className="admin-analytics-chart-head">
          <h2 className="admin-analytics-chart-title">模块与事件分布</h2>
          <p className="admin-analytics-chart-note">筛选条件下的行为构成</p>
        </div>
        <div className="admin-analytics-distribution-grid">
          <DistributionList title="Top 模块" items={moduleDistribution} />
          <DistributionList title="事件类型" items={eventDistribution} />
        </div>
      </article>
    </section>
  );
}
