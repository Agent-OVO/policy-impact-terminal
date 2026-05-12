export type EntityId = string;
export type ISODateString = string;
export type ISODateTimeString = string;
export type ConfidenceScore = number;
export type Percent = number;

export type ReportStatus =
  | "published"
  | "processing"
  | "draft"
  | "failed"
  | "reviewing"
  | "archived";

export type AnalysisJobStatus =
  | "queued"
  | "fetching"
  | "extracting"
  | "analyzing"
  | "published"
  | "failed";

export type PolicySignal =
  | "positive"
  | "constraint"
  | "risk"
  | "pending"
  | "neutral";

export type EvidenceLevel = "strong" | "indirect" | "pending";

export type RelationType =
  | "direct"
  | "indirect"
  | "beneficiary"
  | "constraint_risk"
  | "pending";

export type IndustrySection = "upstream" | "midstream" | "downstream" | "support";
export type ChainEdgeType = "strong" | "medium" | "weak" | "risk";
export type ClauseTone = "blue" | "purple" | "green" | "orange" | "neutral";

export type KnownModuleId =
  | "brief"
  | "industry"
  | "clauses"
  | "background"
  | "compare"
  | "companies"
  | "evidence";

export type ModuleId = KnownModuleId | (string & {});

export interface PolicyMeta {
  title: string;
  status: string;
  issuer: string;
  publishDate: ISODateString;
  effectiveDate: ISODateString;
  source: string;
  category: string;
  level: string;
  confidence: ConfidenceScore;
  sourceUrl?: string;
  jurisdiction?: string;
  tags?: string[];
}

export interface PolicyAction {
  id: EntityId;
  title: string;
  body: string;
  signal: PolicySignal;
  confidence: ConfidenceScore;
  displaySignal?: string;
  clauseIds?: EntityId[];
  sortOrder?: number;
}

export interface ClauseGroup {
  id: EntityId;
  title: string;
  count: number;
  tone: ClauseTone;
}

export interface PolicyClause {
  id: EntityId;
  no: string;
  title: string;
  group: EntityId;
  excerpt: string;
  confidence: ConfidenceScore;
  keywords: string[];
  industries: string[];
  fullText?: string;
  sortOrder?: number;
}

export interface IndustryNode {
  id: EntityId;
  title: string;
  subtitle: string;
  section: IndustrySection;
  relation: RelationType;
  evidenceLevel: EvidenceLevel;
  confidence: ConfidenceScore;
  description: string;
  clauseIds: EntityId[];
  companyIds: EntityId[];
  iconKey?: string;
  displayRelation?: string;
  displayEvidenceLevel?: string;
}

export interface IndustryEdge {
  from: EntityId;
  to: EntityId;
  type: ChainEdgeType;
  confidence?: ConfidenceScore;
}

export interface CompanyImpact {
  id: EntityId;
  name: string;
  ticker: string;
  platform: string;
  status: string;
  section: IndustrySection;
  relation: RelationType;
  evidenceLevel: EvidenceLevel;
  confidence: ConfidenceScore;
  evidenceCount: number;
  products: string[];
  reason: string;
  uncertainty: string;
  exchange?: string;
  nodeIds?: EntityId[];
  displayRelation?: string;
  displayEvidenceLevel?: string;
}

export interface EvidenceLinks {
  clauseIds?: EntityId[];
  nodeIds?: EntityId[];
  companyIds?: EntityId[];
}

export interface EvidenceItem {
  id: EntityId;
  title: string;
  source: string;
  type: string;
  date: ISODateString;
  excerpt: string;
  confidence: ConfidenceScore;
  url?: string;
  links?: EvidenceLinks;
}

export interface PolicyBackgroundCard {
  id?: EntityId;
  title: string;
  body: string;
  evidenceIds?: EntityId[];
}

export interface PolicyComparisonRow {
  id: EntityId;
  dimension: string;
  values: string[];
}

export interface CompareBaselinePolicy {
  id?: EntityId;
  title: string;
  issuer?: string;
  source?: string;
  publishDate?: ISODateString;
  similarity?: ConfidenceScore;
  reason?: string;
}

export interface CompareInsightRow {
  id: EntityId;
  dimension: string;
  current: string;
  similar: string;
  different: string;
  explanation?: string;
  clauseIds?: EntityId[];
  evidenceIds?: EntityId[];
}

export interface CompareInsights {
  status?: string;
  basis?: string;
  method?: string;
  emptyReason?: string;
  comparableCount?: number;
  similarPolicy?: CompareBaselinePolicy | null;
  differencePolicy?: CompareBaselinePolicy | null;
  similarPolicies?: CompareBaselinePolicy[];
  contrastPolicies?: CompareBaselinePolicy[];
  similarityPoints: string[];
  differencePoints: string[];
  rows: CompareInsightRow[];
}

export interface AnalysisCoverage {
  status?: string;
  textLength?: number;
  clauseCount: number;
  actionCount?: number;
  evidenceCount: number;
  industryNodeCount: number;
  companyCount: number;
  matchedKeywordCount?: number;
  comparablePolicyCount?: number;
  limitations: string[];
}

export interface ReportNavItem {
  id: ModuleId;
  label: string;
  badge?: string;
}

export interface PolicySummary {
  id: EntityId;
  title: string;
  issuer: string;
  source: string;
  publishDate: ISODateString;
  status: ReportStatus;
  confidence: ConfidenceScore;
  industryCount: number;
  companyCount: number;
  evidenceCount: number;
  primarySignal: string;
  category?: string;
  updatedAt?: ISODateTimeString;
}

export interface AnalysisJob {
  id: EntityId;
  title: string;
  sourceUrl: string;
  sourceName: string;
  status: AnalysisJobStatus;
  progress: Percent;
  createdAt: ISODateTimeString;
  currentStep: string;
  policyId?: EntityId;
  errorMessage?: string;
}

export interface PolicyBrief {
  judgement: string;
  summary?: string;
  keyPoints?: string[];
  methodology?: string;
}

export interface PolicyReport {
  id: EntityId;
  summary: PolicySummary;
  brief?: PolicyBrief;
  policy: PolicyMeta;
  actions: PolicyAction[];
  clauseGroups: ClauseGroup[];
  clauses: PolicyClause[];
  chainNodes: IndustryNode[];
  chainEdges: IndustryEdge[];
  companies: CompanyImpact[];
  evidence: EvidenceItem[];
  backgroundCards: PolicyBackgroundCard[];
  compareRows: PolicyComparisonRow[];
  compareInsights?: CompareInsights;
  analysisCoverage?: AnalysisCoverage;
  modules: ReportNavItem[];
  topTabs: ReportNavItem[];
  generatedAt?: ISODateTimeString;
}
