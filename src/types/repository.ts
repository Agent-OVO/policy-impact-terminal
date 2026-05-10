import type {
  AnalysisJobStatus,
  EntityId,
  ISODateString,
  ISODateTimeString,
  Percent,
  ReportStatus
} from "./policy";

export interface PolicySummaryCounts {
  industryCount?: number;
  companyCount?: number;
  evidenceCount?: number;
  primarySignal?: string;
}

export interface PolicySummaryRow extends PolicySummaryCounts {
  id: EntityId;
  title: string | null;
  issuer?: string | null;
  source?: string | null;
  source_name?: string | null;
  publishDate?: ISODateString | null;
  publish_date?: ISODateString | null;
  status?: ReportStatus | string | null;
  confidence?: number | null;
  category?: string | null;
  updatedAt?: ISODateTimeString | null;
  updated_at?: ISODateTimeString | null;
}

export interface AnalysisJobRow {
  id: EntityId;
  policy_id?: EntityId | null;
  title?: string | null;
  source_url?: string | null;
  source_name?: string | null;
  status?: AnalysisJobStatus | string | null;
  progress?: Percent | null;
  created_at?: ISODateTimeString | null;
  current_step?: string | null;
  error_message?: string | null;
}
