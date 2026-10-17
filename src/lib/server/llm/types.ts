import type {
  ChunkProfiling,
  ContractualDuration,
  DocumentSection,
  DocumentType,
  ExtractedTenderMetadata,
  RequirementCategory,
  SourceReference,
  TenderAnalysisResult,
  TenderRequirement,
} from "@/types/tender";

export type {
  ChunkProfiling,
  ContractualDuration,
  DocumentSection,
  DocumentType,
  ExtractedTenderMetadata,
  TenderAnalysisResult,
};

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmGenerateOptions {
  temperature?: number;
  timeoutMs?: number;
  format?: "json" | Record<string, unknown>;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateJson(messages: LlmMessage[], options?: LlmGenerateOptions): Promise<string>;
  checkHealth(): Promise<{ available: boolean; model: string; error?: string }>;
}

export interface RawExtractedRequirement {
  id?: string;
  title: string;
  category: RequirementCategory;
  mandatory: boolean | "unknown";
  normalizedCondition: string;
  pageNumber: number | null;
  clauseNumber?: string;
  excerpt: string;
  rationale: string;
  requiresHumanReview?: boolean;
}
