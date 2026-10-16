export type RequirementStatus = "MET" | "UNMET" | "UNKNOWN";

export type RequirementCategory =
  | "eligibility"
  | "financial"
  | "experience"
  | "registration"
  | "certification"
  | "emd"
  | "deadline"
  | "technical"
  | "other";

/** confirmed = human accepted the finding; rejected = human disputes it; flagged = needs further review */
export type ReviewState = "pending" | "confirmed" | "rejected" | "flagged";

export interface SourceReference {
  documentId: string;
  pageNumber: number | null;
  clauseNumber?: string;
  excerpt: string;
}

export interface TenderRequirement {
  id: string;
  title: string;
  category: RequirementCategory;
  mandatory: boolean | "unknown";
  normalizedCondition: string;
  source: SourceReference | null;
  status: RequirementStatus;
  matchedEvidenceIds: string[];
  rationale: string;
  requiresHumanReview: boolean;
  review: ReviewState;
  reviewNote?: string | undefined;
  reviewedAt?: string | undefined;
}

export type DocumentStatus =
  | "processing"
  | "ready"
  | "failed"
  | "mapping_incomplete"
  | "unsupported"
  | "not_processed";

export interface TenderDocument {
  id: string;
  filename: string;
  kind: "tender" | "evidence";
  sizeBytes: number | null;
  status: DocumentStatus;
  sourceType: "user_upload" | "illustrative";
  note?: string | undefined;
}

export interface EvidenceRecord {
  id: string;
  label: string;
  kind: "turnover" | "project" | "registration" | "identity";
  detail: string;
}

export type Recommendation = "PROCEED" | "INVESTIGATE" | "SKIP";

export interface Assessment {
  id: string;
  demo: boolean;
  title: string;
  reference: string;
  authority: string;
  procurementSource: string;
  deadline: string | null;
  emdAmount?: string | undefined;
  companyId: string;
  /** Snapshot of the company evidence used, so later profile edits don't rewrite history */
  evidenceSnapshot: EvidenceRecord[];
  documents: TenderDocument[];
  requirements: TenderRequirement[];
  createdAt: string;
  updatedAt: string;
}

export type EvidenceState = "not_provided" | "uploaded_unreviewed" | "reviewed" | "expired";

export interface TurnoverRecord {
  id: string;
  financialYear: string;
  amountInr: number;
  state: EvidenceState;
}
export interface ProjectRecord {
  id: string;
  name: string;
  client: string;
  valueInr: number;
  completed: string;
  state: EvidenceState;
}
export interface RegistrationRecord {
  id: string;
  name: string;
  authority: string;
  validUntil: string | null;
  state: EvidenceState;
}

export interface CompanyProfile {
  id: string;
  legalName: string;
  businessType: string;
  identifiers: string;
  address: string;
  turnover: TurnoverRecord[];
  projects: ProjectRecord[];
  registrations: RegistrationRecord[];
  updatedAt: string;
}
