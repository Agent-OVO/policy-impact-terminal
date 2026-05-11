import type { ChainNode, RelationType } from "../../data/policy";

export const companySectionLabels: Record<ChainNode["section"], string> = {
  upstream: "上游基础",
  midstream: "中游平台",
  downstream: "下游应用",
  support: "配套保障"
};

export const companySectionOrder: ChainNode["section"][] = ["upstream", "midstream", "downstream", "support"];

export const companyRelationClass: Record<RelationType, string> = {
  直接相关: "positive",
  间接相关: "neutral",
  潜在受益: "warm",
  约束风险: "risk",
  待验证: "pending"
};

export const companyMatrixOffsets = [
  [0, 0],
  [4, -3],
  [-5, 3],
  [6, 5],
  [-4, 7],
  [3, -8],
  [-7, -5],
  [8, -1],
  [-8, 2],
  [1, 9],
  [-2, -10],
  [9, 7],
  [-9, -8]
] as const;
