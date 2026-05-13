import type {
  CompanyImpact,
  EvidenceItem,
  IndustryNode,
  PolicyReport,
  PolicySummary,
  ReportStatus
} from "../types";
import { averageConfidence } from "./confidence";
import { groupBy, uniqueValues } from "./collections";

export interface ReportStats {
  industryCount: number;
  companyCount: number;
  evidenceCount: number;
  averageConfidence: number;
  primarySignal: string;
}

export function getPrimarySignal(nodes: readonly IndustryNode[]): string {
  const [topNode] = [...nodes].sort((left, right) => right.confidence - left.confidence);
  return topNode?.title ?? "";
}

export function calculateReportStats(report: Pick<
  PolicyReport,
  "chainNodes" | "companies" | "evidence" | "actions" | "policy"
>): ReportStats {
  const confidenceInputs = [
    report.policy.confidence,
    ...report.actions.map((action) => action.confidence),
    ...report.chainNodes.map((node) => node.confidence),
    ...report.companies.map((company) => company.confidence),
    ...report.evidence.map((item) => item.confidence)
  ];

  return {
    industryCount: report.chainNodes.length,
    companyCount: report.companies.length,
    evidenceCount: report.evidence.length,
    averageConfidence: averageConfidence(confidenceInputs),
    primarySignal: getPrimarySignal(report.chainNodes)
  };
}

export function createPolicySummary(
  report: Pick<
    PolicyReport,
    "id" | "policy" | "chainNodes" | "companies" | "evidence" | "actions"
  >,
  status: ReportStatus = "published"
): PolicySummary {
  const stats = calculateReportStats(report);

  return {
    id: report.id,
    title: report.policy.title,
    issuer: report.policy.issuer,
    source: report.policy.source,
    publishDate: report.policy.publishDate,
    publishDateTime: report.policy.publishDateTime,
    officialPublishedAt: report.policy.officialPublishedAt,
    publishTimezone: report.policy.publishTimezone,
    status,
    confidence: report.policy.confidence || stats.averageConfidence,
    industryCount: stats.industryCount,
    companyCount: stats.companyCount,
    evidenceCount: stats.evidenceCount,
    primarySignal: stats.primarySignal,
    category: report.policy.category
  };
}

export function getCompaniesBySection(
  companies: readonly CompanyImpact[]
): Record<string, CompanyImpact[]> {
  return groupBy(companies, (company) => company.section);
}

export function getEvidenceSources(evidence: readonly EvidenceItem[]): string[] {
  return uniqueValues(evidence.map((item) => item.source));
}
