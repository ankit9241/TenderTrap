import { z } from "zod";
import type { DocumentType, RequirementCategory } from "@/types/tender";

export const CATEGORIES: [RequirementCategory, ...RequirementCategory[]] = [
  "eligibility",
  "financial",
  "experience",
  "registration",
  "certification",
  "emd",
  "deadline",
  "technical",
  "other",
];

export const DOCUMENT_TYPES: [DocumentType, ...DocumentType[]] = [
  "tender_notice",
  "contract_conditions",
  "circular_or_policy",
  "amendment_or_corrigendum",
  "mixed_compilation",
  "unknown",
];

export const DocumentSectionSchema = z.object({
  id: z.string().catch(() => `sec-${Math.random().toString(36).slice(2, 7)}`),
  title: z.string().catch("Section"),
  documentType: z
    .string()
    .transform((val) => {
      const lower = val.toLowerCase().trim();
      return (DOCUMENT_TYPES.includes(lower as DocumentType) ? lower : "unknown") as DocumentType;
    })
    .catch("unknown"),
  pageRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).catch([1, 1]),
  reference: z.string().nullable().optional(),
  authority: z.string().nullable().optional(),
  summary: z.string().optional(),
});

export const ContractualDurationSchema = z.object({
  description: z.string().catch("Contractual duration"),
  duration: z.string().catch(""),
  pageNumber: z.number().int().positive().nullable().catch(null),
});

export const ExtractedTenderMetadataSchema = z.object({
  title: z.string().nullable().catch(null),
  reference: z.string().nullable().catch(null),
  authority: z.string().nullable().catch(null),
  procurementSource: z.string().nullable().catch(null),
  estimatedValue: z.string().nullable().catch(null),
  emdAmount: z.string().nullable().catch(null),
  tenderFee: z.string().nullable().catch(null),
  bidSubmissionDeadline: z.string().nullable().catch(null),
  deadline: z.string().nullable().catch(null),
  documentType: z
    .string()
    .transform((val) => {
      const lower = val.toLowerCase().trim();
      return (DOCUMENT_TYPES.includes(lower as DocumentType) ? lower : "unknown") as DocumentType;
    })
    .catch("unknown"),
  sections: z.array(DocumentSectionSchema).catch([]),
  contractualDurations: z.array(ContractualDurationSchema).catch([]),
  importantDates: z
    .array(
      z.object({
        event: z.string().catch("Important Date"),
        date: z.string().catch(""),
      }),
    )
    .catch([]),
  isCompilation: z.boolean().catch(false),
});

export const RawExtractedRequirementSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "Requirement title is required"),
  category: z
    .string()
    .transform((val) => {
      const lower = val.toLowerCase().trim();
      return (CATEGORIES.includes(lower as RequirementCategory) ? lower : "other") as RequirementCategory;
    }),
  mandatory: z
    .union([z.boolean(), z.literal("unknown")])
    .catch("unknown"),
  normalizedCondition: z.string().catch(""),
  pageNumber: z.number().int().positive().nullable().catch(null),
  clauseNumber: z.string().nullable().optional(),
  excerpt: z.string().catch(""),
  rationale: z.string().catch(""),
  requiresHumanReview: z.boolean().catch(false),
  sectionId: z.string().optional(),
  sectionTitle: z.string().optional(),
});

export const LlmExtractionChunkSchema = z.object({
  metadata: ExtractedTenderMetadataSchema.optional(),
  requirements: z.array(RawExtractedRequirementSchema).catch([]),
  warnings: z.array(z.string()).catch([]),
});

export type LlmExtractionChunk = z.infer<typeof LlmExtractionChunkSchema>;
