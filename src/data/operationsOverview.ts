export type OperationsMainline = {
  id: string;
  kicker: string;
  title: string;
  judgement: string;
  chain: string[];
  nextFacts: string[];
  reportIds: string[];
};

export const OPERATIONS_CURRENT_WINDOW_DAYS = 14;
export const OPERATIONS_RECENT_REPORT_LIMIT = 3;

export const operationsMainlines: OperationsMainline[] = [
  {
    id: "energy-manufacturing",
    kicker: "主线一 · 能源与制造",
    title: "从能源供给扩张进入成本、改造和全生命周期责任",
    judgement:
      "不能再用“新能源利好”概括。绿电履责、输配电价、工业改造、节能监察和长期资产责任正在同时改变成本与项目入口。",
    chain: ["供给扩张", "强制消费", "网络价格", "绿电直连", "零碳与智能改造", "监察与退出"],
    nextFacts: [
      "福建多用户绿电直连细则和首批项目",
      "2026年8月后福建典型制造企业实际电费账单",
      "零碳工厂、智能工厂名单中的总投资和集成商"
    ],
    reportIds: [
      "f11dad0b-2c39-452a-b6d5-ce95a7f209f5",
      "654132bb-86bd-42e6-ac1e-c2e2b5159b4c",
      "ab109913-f9c4-4fa4-bc2b-cf32d80c99bc"
    ]
  },
  {
    id: "manufacturing-realization",
    kicker: "主线二 · 制造业经营兑现",
    title: "强制改造形成需求，保险工具降低首次应用风险",
    judgement:
      "政策价值只有跨过资格、真实用户、合同、交付、保单和资金复核后，才可能进入收入、利润和现金流。目录或技术方向本身不是公司经营证据。",
    chain: ["强制改造", "首次应用", "保险分险", "财政补助", "合同与交付", "经营兑现"],
    nextFacts: [
      "各省重点行业节能降碳企业项目清单和核定投资",
      "2026年首台套资格审定、用户交付和保费补助项目",
      "2026年首批次新材料最终用户、销售交付和资金名单"
    ],
    reportIds: [
      "fe1716c6-453e-43c8-a670-154421b15876",
      "469e5097-2b94-4ad4-b40d-e8d037d9f65c",
      "f233bba0-b49d-4c22-9bc4-ddd9d33f5548"
    ]
  }
];
