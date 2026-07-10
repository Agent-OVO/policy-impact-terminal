import type { EntityId, ISODateString, ISODateTimeString, PolicyReport } from "./policy";

export type ReportRevisionStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "published"
  | "superseded"
  | "rejected";

export type ProjectionRunStatus = "pending" | "running" | "succeeded" | "failed";
export type ModelUsageStatus = "planned" | "succeeded" | "failed" | "blocked";
export type ModelBudgetClass = "L0" | "L1" | "L2" | "L3" | "exception";
export type ConfigVisibility = "internal" | "client";
export type ConfigVersionStatus = "draft" | "active" | "retired";

export interface PolicySourceSegmentRecord {
  id: EntityId;
  policyId: EntityId;
  sourceDocumentId: EntityId;
  segmentKey: string;
  sortOrder: number;
  headingLevel?: number | null;
  headingPath: string[];
  pageNumber?: number | null;
  sourceLocator: Record<string, unknown>;
  segmentText: string;
  segmentHash: string;
  createdAt: ISODateTimeString;
}

export interface PolicySourceDocumentRecord {
  id: EntityId;
  policyId: EntityId;
  parentDocumentId?: EntityId | null;
  sourceUrl?: string | null;
  normalizedText: string;
  sourceDocumentHash: string;
  parserVersion: string;
  fetchedAt?: ISODateTimeString | null;
  officialPublishedAt?: ISODateTimeString | null;
  metadata: Record<string, unknown>;
  createdAt: ISODateTimeString;
  segments?: PolicySourceSegmentRecord[];
}

export interface ReportRevisionRecord {
  id: EntityId;
  policyId: EntityId;
  parentRevisionId?: EntityId | null;
  status: ReportRevisionStatus;
  payload: PolicyReport;
  schemaVersion: string;
  analysisVersion: string;
  projectionVersion: string;
  sourceDocumentHash: string;
  contentHash: string;
  projectionHash?: string | null;
  changeSummary?: string | null;
  changeReason?: string | null;
  createdBy?: EntityId | null;
  reviewedBy?: EntityId | null;
  createdAt: ISODateTimeString;
  reviewedAt?: ISODateTimeString | null;
  publishedAt?: ISODateTimeString | null;
}

export interface ReportProjectionCounts {
  policyActions: number;
  industryNodes: number;
  industryEdges: number;
  companyRelations: number;
  policyNetworkRelations: number;
  evidenceRefs: number;
  signals: number;
}

export interface CurrentReportRevisionResponse {
  policyId: EntityId;
  revisionId: EntityId;
  schemaVersion: string;
  analysisVersion: string;
  projectionVersion: string;
  sourceDocumentHash: string;
  currentSourceDocumentHash?: string | null;
  isSourceCurrent: boolean;
  contentHash: string;
  projectionHash: string;
  publishedAt: ISODateTimeString;
  payload: PolicyReport;
}

export interface ReportRevisionHistoryItem {
  revisionId: EntityId;
  parentRevisionId?: EntityId | null;
  status: "published" | "superseded";
  schemaVersion: string;
  analysisVersion: string;
  projectionVersion: string;
  sourceDocumentHash: string;
  currentSourceDocumentHash?: string | null;
  isSourceCurrent: boolean;
  contentHash: string;
  projectionHash: string;
  changeSummary?: string | null;
  changeReason?: string | null;
  publishedAt: ISODateTimeString;
  isCurrent: boolean;
}

export interface ModelUsageLedgerRecord {
  id: EntityId;
  policyId?: EntityId | null;
  revisionId?: EntityId | null;
  operationType: string;
  provider?: string | null;
  model: string;
  promptVersion?: string | null;
  requestHash?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  effectiveTokens: number;
  budgetClass: ModelBudgetClass;
  triggerReason: string;
  status: ModelUsageStatus;
  exceptionReason?: string | null;
  metadata: Record<string, unknown>;
  createdBy?: EntityId | null;
  createdAt: ISODateTimeString;
}

export interface SystemConfigVersionRecord {
  id: EntityId;
  configKey: string;
  versionNo: number;
  configValue: Record<string, unknown>;
  visibility: ConfigVisibility;
  status: ConfigVersionStatus;
  effectiveAt?: ISODateTimeString | null;
  supersedesId?: EntityId | null;
  changeReason: string;
  createdBy?: EntityId | null;
  createdAt: ISODateTimeString;
}

export interface CompanyEvidenceCardRecord {
  id: EntityId;
  companyKey: string;
  companyName: string;
  ticker?: string | null;
  factType: string;
  sourceName: string;
  sourceUrl: string;
  sourceDate?: ISODateString | null;
  excerpt: string;
  interpretation?: string | null;
  contentHash: string;
  evidenceLevel: "strong" | "indirect" | "pending";
  status: "active" | "superseded" | "invalidated";
  validFrom?: ISODateString | null;
  expiresAt?: ISODateString | null;
  metadata: Record<string, unknown>;
}
