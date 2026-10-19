import type { ExtractedPage } from "../pdf";
import type {
  LlmMessage,
  LlmProvider,
  TenderAnalysisResult,
  ExtractedTenderMetadata,
  ChunkProfiling,
} from "./types";
import { OllamaProvider } from "./ollama";
import { LlmExtractionChunkSchema } from "./schema";
import type { DocumentSection, DocumentType, TenderRequirement } from "@/types/tender";
import { sanitizeError } from "../db";
import {
  classifyDocumentAndSections,
  separateDeadlinesAndDurations,
  isValidBidSubmissionDeadline,
} from "./classification";

let mockProvider: LlmProvider | null = null;

export function setMockLlmProvider(mock: LlmProvider | null): void {
  mockProvider = mock;
}

export function getLlmProvider(): LlmProvider {
  if (mockProvider) {
    return mockProvider;
  }

  const providerType = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
  if (providerType === "ollama") {
    return new OllamaProvider();
  }

  throw new Error(`Unsupported LLM_PROVIDER: '${providerType}'. Supported providers: 'ollama'`);
}

export const DEFAULT_MAX_PAGES_PER_CHUNK = 2;
export const DEFAULT_MAX_CHARS_PER_CHUNK = 7_000;

export function normalizeFidelityText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function checkExcerptMatchesPage(pageText: string, excerpt: string): boolean {
  const normExcerpt = normalizeFidelityText(excerpt);
  if (!normExcerpt || normExcerpt.length === 0) return false;

  const normSource = normalizeFidelityText(pageText);
  if (normSource.includes(normExcerpt)) {
    return true;
  }

  // If excerpt is substantial (>= 20 chars), check prefix or suffix
  if (normExcerpt.length >= 20) {
    const prefix = normExcerpt.slice(0, 20);
    const suffix = normExcerpt.slice(-20);
    if (normSource.includes(prefix) || normSource.includes(suffix)) {
      return true;
    }
  }

  return false;
}

export function buildDynamicChunks(
  pages: ExtractedPage[],
  maxPages = DEFAULT_MAX_PAGES_PER_CHUNK,
  maxChars = DEFAULT_MAX_CHARS_PER_CHUNK,
): ExtractedPage[][] {
  const chunks: ExtractedPage[][] = [];
  let currentChunk: ExtractedPage[] = [];
  let currentChars = 0;

  for (const p of pages) {
    const charCount = p.characterCount || p.text?.length || 0;
    const wouldExceedChars = currentChunk.length > 0 && currentChars + charCount > maxChars;
    const wouldExceedPages = currentChunk.length >= maxPages;

    if (wouldExceedChars || wouldExceedPages) {
      chunks.push(currentChunk);
      currentChunk = [p];
      currentChars = charCount;
    } else {
      currentChunk.push(p);
      currentChars += charCount;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Detects whether an excerpt is merely a heading, title, or label that does not
 * substantiate an operative qualification requirement or contractual obligation.
 */
export function isTitleOnlyExcerpt(excerpt: string, title?: string): boolean {
  if (!excerpt || !excerpt.trim()) return true;
  const trimmed = excerpt.trim();
  const normExcerpt = normalizeFidelityText(trimmed);

  // If excerpt is identical to the title
  if (title && normExcerpt === normalizeFidelityText(title)) return true;

  // Explicit bare heading patterns
  const bareHeadingPatterns = [
    /^demotion\s+to\s+(?:a\s+)?lower\s+class$/i,
    /^suspension\s+of\s+business(?:\s+for\s+\w+)?$/i,
    /^warning\s+to\s+be\s+issued$/i,
    /^removal\s+from\s+(?:the\s+)?approved\s+list$/i,
    /^clause\s+\d+(?:\.\d+)?$/i,
    /^para\s+\d+(?:\.\d+)?$/i,
    /^annexure\s*['"‘"]?[a-z0-9]['"’”]?$/i,
    /^table\s+[a-z0-9]+$/i,
    /^general\s+rules$/i,
    /^scope\s+of\s+work$/i,
  ];

  if (bareHeadingPatterns.some((p) => p.test(trimmed))) {
    return true;
  }

  // Very short excerpts (< 35 chars) without operative/obligation keywords
  if (normExcerpt.length < 35) {
    const hasOperativeKeyword =
      /\b(?:shall|must|required|require|eligib|minimum|maximum|turnover|deposit|guarantee|furnish|submit|pay|cost|certificate|penalty|liable|valid|validity|period|experience|crore|lakh|rs|inr|within|delay|comply)\b/i.test(
        normExcerpt,
      );
    if (!hasOperativeKeyword) {
      return true;
    }
  }

  return false;
}

/**
 * Searches the page text for a complete operative sentence containing the excerpt,
 * allowing the extraction pipeline to preserve the full operative clause when available.
 */
export function findOperativeSentenceOnPage(pageText: string, excerpt: string): string | null {
  if (!pageText || !excerpt || !excerpt.trim()) return null;
  const cleanExcerpt = excerpt.trim().toLowerCase();
  // Split on newlines or sentence-ending punctuation
  const linesAndSentences = pageText
    .split(/\r?\n|[.!?](?:\s+|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const s of linesAndSentences) {
    // If it is a table row or heading marker, it is NOT an operative sentence
    if (s.includes("|") || /^table\s+\d+/i.test(s) || /clause\s*\|\s*action/i.test(s)) {
      continue;
    }
    const lower = s.toLowerCase();
    if (lower.includes(cleanExcerpt) && s.length >= cleanExcerpt.length + 20) {
      // Must contain an operative obligation or directive verb
      const hasOperativeVerb =
        /\b(?:shall|must|will|stipulate|provides?|imposed|required|require|liable|ordered|directed)\b/i.test(
          s,
        );
      if (hasOperativeVerb) {
        return s.replace(/\s+/g, " ");
      }
    }
  }
  return null;
}

const EXTRACTION_SYSTEM_PROMPT = `You are TenderTrap's deterministic eligibility analyst for Indian government and public procurement tenders.
Your task is to extract factual tender clauses and eligibility requirements with strict fidelity to the text.

RULES:
1. Extract ONLY criteria explicitly stated in the document text.
2. NEVER extrapolate, assume, or invent figures, dates, turnover values, authorities, or clauses.
3. If an attribute (such as EMD, turnover, or deadline) is absent, set it to null.
4. DOCUMENT CLASSIFICATION:
   - Identify the documentType: "tender_notice", "contract_conditions", "circular_or_policy", "amendment_or_corrigendum", "mixed_compilation", or "unknown".
   - If the document is a circular, policy clarification, office memorandum, CPWD works manual, or GCC conditions, classify accurately and NEVER invent a tender ID, EMD, estimated value, or submission deadline.
5. BID SUBMISSION DEADLINE vs CONTRACTUAL DURATIONS:
   - "bidSubmissionDeadline" MUST ONLY be an actual calendar date/time when bids must be submitted (e.g. "2026-04-15 15:00", "15.03.2026 at 3:00 PM").
   - NEVER classify contractual durations, completion periods, defect liability periods, or performance guarantee validity (e.g. "six months beyond the date of completion", "validity of PG shall be 60 days", "12 months defect liability period") as a bid submission deadline. If no explicit bid submission deadline is stated, set bidSubmissionDeadline to null.
6. For every extracted requirement:
   - "pageNumber" MUST be the exact integer page number where the text appears.
   - "excerpt" MUST be a supporting quotation directly from that page's text.
   - "category" MUST be one of: "financial", "experience", "registration", "certification", "emd", "deadline", "technical", "eligibility", "other".
     * IMPORTANT: Performance Security, Performance Guarantee (PG), and Additional Performance Guarantee (APG) are post-award contractual securities and MUST be categorized as "financial", NEVER as "emd". The "emd" category is strictly reserved for pre-bid earnest money deposits / bid securities.
   - "mandatory": true if compulsory for qualification, false if optional/desirable, "unknown" if unspecified.
   - "normalizedCondition": clean mathematical or declarative summary (e.g. "Annual turnover >= INR 15 Cr in last 3 FYs", "Completed 1 similar bridge project >= INR 8 Cr").
7. OPERATIVE REQUIREMENTS vs TITLES & DISCIPLINARY POLICY:
   - Extract ONLY operative criteria that impose an explicit duty, qualification rule, or submission requirement.
   - NEVER extract bare table headers, clause titles, section headings, or penalty labels (such as "Demotion to a lower class" or "Suspension of business") as requirements when the excerpt merely repeats the title.
   - Distinguish internal departmental disciplinary guidelines, punitive policies, and administrative actions (e.g. warning, demotion, suspension, removal from approved list) from bidder eligibility criteria: categorize them as "other", mark mandatory as false, and flag requiresHumanReview: true.
8. Return ONLY a valid JSON object matching the requested schema. No markdown formatting or extra commentary.`;

function buildChunkPrompt(pages: ExtractedPage[], isFirstChunk: boolean): LlmMessage[] {
  let docBody = "";
  for (const p of pages) {
    if (p.text && p.text.trim()) {
      docBody += `\n--- PAGE ${p.pageNumber} ---\n${p.text.trim()}\n`;
    }
  }

  const userPrompt = `Extract tender requirements from the following document pages.${
    isFirstChunk
      ? " Also extract metadata (documentType, title, authority, reference, value, EMD, bidSubmissionDeadline) from these initial pages."
      : ""
  }

${docBody}

Return JSON with this exact structure:
{
  ${
    isFirstChunk
      ? `"metadata": {
    "documentType": "tender_notice or contract_conditions or circular_or_policy or amendment_or_corrigendum or mixed_compilation or unknown",
    "title": "string or null",
    "reference": "string or null",
    "authority": "string or null",
    "procurementSource": "string or null",
    "estimatedValue": "string or null",
    "emdAmount": "string or null",
    "tenderFee": "string or null",
    "bidSubmissionDeadline": "actual submission date or null",
    "deadline": "actual submission date or null",
    "importantDates": [{"event": "string", "date": "string"}]
  },`
      : ""
  }
  "requirements": [
    {
      "title": "Short title",
      "category": "financial",
      "mandatory": true,
      "normalizedCondition": "Standardized criteria summary",
      "pageNumber": 1,
      "clauseNumber": "optional clause string or null",
      "excerpt": "verbatim text excerpt from page",
      "rationale": "brief reason this is an eligibility criterion",
      "requiresHumanReview": false
    }
  ],
  "warnings": ["any warnings or ambiguities noticed"]
}
(Allowed category values: "financial", "experience", "registration", "certification", "emd", "deadline", "technical", "eligibility", "other". Allowed mandatory values: true, false, "unknown".)`;

  return [
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}

export interface AnalyzeTenderOptions {
  totalPageCount?: number;
  processedPageCount?: number;
  attemptedPageCount?: number;
  unprocessedPages?: number[];
  ocrPageLimit?: number;
  extractionStatus?: "success" | "partial_ocr";
  ocrStatus?: "not_needed" | "completed" | "partial" | "failed";
  ocrConfidenceAvg?: number | null;
  warnings?: string[];
}

export async function analyzeTenderPages(
  pages: ExtractedPage[],
  filename: string,
  extractionId: string,
  options?: AnalyzeTenderOptions,
): Promise<TenderAnalysisResult> {
  const provider = getLlmProvider();

  // Filter pages that contain usable text to avoid empty LLM prompts
  const usablePages = pages.filter(
    (p) =>
      p.text &&
      p.text.trim().length > 0 &&
      (p.method === "native" || p.ocrStatus === "success" || p.ocrStatus === "low_confidence"),
  );

  if (usablePages.length === 0) {
    throw new Error("No usable text available in document pages to perform LLM analysis.");
  }

  // 1. Run deterministic structural classification across pages
  const classification = classifyDocumentAndSections(pages);

  // Divide usable pages into bounded dynamic chunks
  const chunks = buildDynamicChunks(usablePages);

  let mergedMetadata: ExtractedTenderMetadata = {
    title: null,
    reference: null,
    authority: null,
    procurementSource: null,
    estimatedValue: null,
    emdAmount: null,
    tenderFee: null,
    bidSubmissionDeadline: null,
    deadline: null,
    importantDates: [],
    contractualDurations: [],
    documentType: classification.overallType,
    sections: classification.sections,
    isCompilation: classification.isCompilation,
  };

  const rawRequirements: any[] = [];
  const mergedWarnings: string[] = [];
  const profiling: ChunkProfiling[] = [];
  let totalCharacters = 0;

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunkPages = chunks[idx]!;
    const chunkChars = chunkPages.reduce(
      (sum, p) => sum + (p.characterCount || p.text?.length || 0),
      0,
    );
    totalCharacters += chunkChars;

    const startTime = Date.now();
    let chunkStatus: "success" | "error" = "success";
    let chunkError: string | undefined;
    let newReqsCount = 0;

    try {
      const messages = buildChunkPrompt(chunkPages, idx === 0);
      const jsonString = await provider.generateJson(messages, { temperature: 0.1 });

      let parsedJson: unknown;
      try {
        // Clean potential markdown backticks if model wrapped JSON
        const cleanJson = jsonString
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        parsedJson = JSON.parse(cleanJson);
      } catch {
        throw new Error(`LLM returned malformed JSON on chunk ${idx + 1}`);
      }

      const chunkResult = LlmExtractionChunkSchema.safeParse(parsedJson);
      if (!chunkResult.success) {
        const issueDetails = chunkResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(`Schema validation failed on chunk ${idx + 1}: ${issueDetails}`);
      }

      const data = chunkResult.data;

      if (idx === 0 && data.metadata) {
        mergedMetadata = {
          title: data.metadata.title,
          reference: data.metadata.reference,
          authority: data.metadata.authority,
          procurementSource: data.metadata.procurementSource,
          estimatedValue: data.metadata.estimatedValue,
          emdAmount: data.metadata.emdAmount,
          tenderFee: data.metadata.tenderFee,
          bidSubmissionDeadline:
            data.metadata.bidSubmissionDeadline || data.metadata.deadline || null,
          deadline: data.metadata.deadline || data.metadata.bidSubmissionDeadline || null,
          importantDates: data.metadata.importantDates ?? [],
          contractualDurations: data.metadata.contractualDurations ?? [],
          documentType:
            classification.overallType !== "unknown"
              ? classification.overallType
              : data.metadata.documentType,
          sections:
            classification.sections.length > 0
              ? classification.sections
              : (data.metadata.sections ?? []),
          isCompilation: classification.isCompilation || Boolean(data.metadata.isCompilation),
        };
      }

      if (data.warnings?.length) {
        mergedWarnings.push(...data.warnings);
      }

      if (data.requirements?.length) {
        newReqsCount = data.requirements.length;
        rawRequirements.push(...data.requirements);
      }
    } catch (err: unknown) {
      chunkStatus = "error";
      chunkError = sanitizeError(err);
      throw err;
    } finally {
      profiling.push({
        chunkIndex: idx + 1,
        pageNumbers: chunkPages.map((p) => p.pageNumber),
        characterCount: chunkChars,
        durationMs: Date.now() - startTime,
        requirementsCount: newReqsCount,
        status: chunkStatus,
        error: chunkError,
      });
    }
  }

  // Coverage and metadata calculations
  const maxPageInInput = pages.reduce((max, p) => Math.max(max, p.pageNumber), 0);
  const totalPageCount = Math.max(options?.totalPageCount ?? pages.length, maxPageInInput);
  const analyzedPageNumbers = usablePages.map((p) => p.pageNumber);
  const analyzedSet = new Set(analyzedPageNumbers);
  const analyzedPageCount = options?.processedPageCount ?? analyzedSet.size;

  const pageMap = new Map<number, ExtractedPage>();
  for (const p of pages) {
    pageMap.set(p.pageNumber, p);
  }

  // Account for all pages from 1 to totalPageCount consistently:
  // Distinguish:
  // 1. Pages actually sent to LLM: in analyzedSet (analyzedPageCount).
  // 2. Pages extracted but not sent to LLM (e.g. empty/blank text, failed extraction): in unprocessedSet.
  // 3. Pages never extracted: not in pageMap -> in unprocessedSet.
  const unprocessedSet = new Set<number>(options?.unprocessedPages ?? []);
  for (const p of pages) {
    if (
      p.ocrStatus === "unprocessed" ||
      p.ocrStatus === "failed" ||
      (!p.text?.trim() && p.method === "ocr")
    ) {
      unprocessedSet.add(p.pageNumber);
    }
  }

  for (let pNum = 1; pNum <= totalPageCount; pNum++) {
    if (!pageMap.has(pNum) || !analyzedSet.has(pNum)) {
      unprocessedSet.add(pNum);
    }
  }

  // Ensure analyzed pages are strictly excluded from unprocessedPages
  for (const pNum of analyzedSet) {
    unprocessedSet.delete(pNum);
  }

  const unprocessedPages = Array.from(unprocessedSet).sort((a, b) => a - b);

  // Identify low confidence OCR pages and average confidence
  const lowConfidencePages: number[] = [];
  const ocrConfidences: number[] = [];
  let hasOcrPages = false;

  for (const p of pages) {
    if (p.method === "ocr") {
      hasOcrPages = true;
      if (typeof p.confidence === "number") {
        ocrConfidences.push(p.confidence);
      }
      if (
        p.ocrStatus === "low_confidence" ||
        p.requiresHumanReview === true ||
        (typeof p.confidence === "number" && p.confidence < 40)
      ) {
        lowConfidencePages.push(p.pageNumber);
      }
    }
  }

  const ocrConfidenceAvg =
    ocrConfidences.length > 0
      ? Math.round((ocrConfidences.reduce((sum, c) => sum + c, 0) / ocrConfidences.length) * 10) /
        10
      : (options?.ocrConfidenceAvg ?? null);

  let ocrStatus: "not_needed" | "completed" | "partial" | "failed" = "not_needed";
  if (options?.ocrStatus) {
    ocrStatus = options.ocrStatus;
  } else if (hasOcrPages) {
    if (unprocessedPages.length > 0 || pages.some((p) => p.ocrStatus === "failed")) {
      ocrStatus = "partial";
    } else {
      ocrStatus = "completed";
    }
  }

  const isPartial = options?.extractionStatus === "partial_ocr" || unprocessedPages.length > 0;
  const extractionStatus: "success" | "partial_ocr" = isPartial ? "partial_ocr" : "success";

  // Coverage warnings
  const coverageWarnings: string[] = [];
  if (isPartial) {
    const unprocessedDisplay =
      unprocessedPages.length <= 15
        ? unprocessedPages.join(", ")
        : `${unprocessedPages.slice(0, 10).join(", ")} and ${unprocessedPages.length - 10} more`;
    coverageWarnings.push(
      `Document was partially analyzed: ${analyzedPageCount} of ${totalPageCount} pages were processed. Requirements may be incomplete for unprocessed pages (${unprocessedDisplay}).`,
    );
  }

  if (lowConfidencePages.length > 0) {
    coverageWarnings.push(
      `OCR confidence was low on page(s) ${lowConfidencePages.join(", ")}. Requirements extracted from these pages require human review.`,
    );
  }

  // Separate true bid submission deadlines from contractual durations
  const deadlineSeparation = separateDeadlinesAndDurations(
    mergedMetadata.bidSubmissionDeadline || mergedMetadata.deadline,
    mergedMetadata.importantDates,
  );

  const documentType: DocumentType =
    classification.overallType !== "unknown"
      ? classification.overallType
      : mergedMetadata.documentType || "unknown";

  const sections = classification.sections;
  const isCompilation = classification.isCompilation;

  // Clean metadata if document is NOT a tender notice
  let cleanedTitle = mergedMetadata.title;
  let cleanedReference = mergedMetadata.reference;
  let cleanedAuthority = mergedMetadata.authority;
  let cleanedValue = mergedMetadata.estimatedValue;
  let cleanedEmd = mergedMetadata.emdAmount;

  if (documentType !== "tender_notice") {
    // If it's a circular or contract conditions, do not invent EMD or estimated tender values
    if (documentType === "circular_or_policy" || documentType === "contract_conditions") {
      cleanedValue = null;
      cleanedEmd = null;
    }
  }

  const finalMetadata: ExtractedTenderMetadata = {
    title: cleanedTitle,
    reference: cleanedReference,
    authority: cleanedAuthority,
    procurementSource: mergedMetadata.procurementSource,
    estimatedValue: cleanedValue,
    emdAmount: cleanedEmd,
    tenderFee: mergedMetadata.tenderFee,
    bidSubmissionDeadline: deadlineSeparation.bidSubmissionDeadline,
    deadline: deadlineSeparation.bidSubmissionDeadline,
    importantDates: mergedMetadata.importantDates ?? [],
    contractualDurations: deadlineSeparation.contractualDurations,
    documentType,
    sections,
    isCompilation,
  };

  const allWarnings = Array.from(
    new Set([
      ...(options?.warnings ?? []),
      ...classification.warnings,
      ...coverageWarnings,
      ...mergedWarnings,
    ]),
  );

  // Deduplicate and map raw requirements with OCR uncertainty propagation and section attribution
  const requirements: TenderRequirement[] = rawRequirements.map((r, index) => {
    const pageNum =
      typeof r.pageNumber === "number" && pageMap.has(r.pageNumber) ? r.pageNumber : null;
    const sourcePage = pageNum !== null ? pageMap.get(pageNum) : undefined;

    let requiresHumanReview = Boolean(r.requiresHumanReview);
    let rationale = r.rationale || "Extracted clause from document";

    // Requirement Classification: Preserve exact source meaning for Performance Guarantees (PG) vs EMD
    let category = r.category;
    let title = r.title;
    let mandatory = r.mandatory;

    const isPerformanceGuarantee =
      /performance\s+(?:guarantee|security)|(?:\b|^)pg\b|(?:\b|^)apg\b/i.test(r.title) ||
      /performance\s+(?:guarantee|security)|(?:\b|^)pg\b|(?:\b|^)apg\b/i.test(r.excerpt || "") ||
      /performance\s+(?:guarantee|security)|(?:\b|^)pg\b|(?:\b|^)apg\b/i.test(
        r.normalizedCondition || "",
      );
    const mentionsEmd = /earnest\s+money|(?:\b|^)emd\b/i.test(r.excerpt || "");

    if (isPerformanceGuarantee && !mentionsEmd) {
      if (category === "emd") {
        category = "financial";
      }
      // If model erroneously injected "EMD" into the title of a pure Performance Guarantee clause, clean the title
      if (/earnest\s+money|\bemd\b/i.test(title)) {
        title = title
          .replace(
            /(?:\(\s*emd\s*\)|\bearnest\s+money\s*(?:deposit)?\b|\bemd\b)\s*(?:\/|-|&)?\s*/gi,
            "",
          )
          .replace(/^[()\s\/\-&]+|[()\s\/\-&]+$/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!title) {
          title = "Performance Guarantee";
        }
      }
    }

    // Disciplinary & Administrative Penalty Policy Detection:
    // Policies such as demotion to a lower class or suspension of business are departmental disciplinary actions,
    // not bidder qualification criteria.
    const isDisciplinaryOrPenaltyPolicy =
      /\b(?:demotion\s+to\s+(?:a\s+)?lower\s+class|suspension\s+of\s+business|removal\s+from\s+(?:the\s+)?approved\s+list|debarment|disciplinary\s+action|warning\s+to\s+be\s+issued|misbehaves?\s+with\s+(?:mcd|official))\b/i.test(
        `${title} ${r.excerpt || ""} ${r.normalizedCondition || ""}`,
      );

    if (isDisciplinaryOrPenaltyPolicy) {
      category = "other";
      mandatory = false;
      requiresHumanReview = true;
      const policyNote = `[Informational / Disciplinary policy: Clause specifies departmental disciplinary or administrative action rather than contractor qualification criteria.]`;
      rationale = rationale ? `${rationale} ${policyNote}` : policyNote;
    }

    const reportedPage = typeof r.pageNumber === "number" ? r.pageNumber : null;
    let finalPageNumber: number | null = reportedPage;
    let finalExcerpt = r.excerpt || "";

    // Operative Clause Substantiation: Detect Title-Only or Non-Substantiating Excerpts
    if (isTitleOnlyExcerpt(finalExcerpt, title)) {
      const reportedSourcePage = reportedPage !== null ? pageMap.get(reportedPage) : undefined;
      const operativeSentence = reportedSourcePage
        ? findOperativeSentenceOnPage(reportedSourcePage.text, finalExcerpt)
        : null;

      if (operativeSentence && !isTitleOnlyExcerpt(operativeSentence, title)) {
        finalExcerpt = operativeSentence;
      } else {
        requiresHumanReview = true;
        const headingNote = `[Requires verification: Cited excerpt is only a heading/title and does not substantiate an operative requirement.]`;
        rationale = rationale ? `${rationale} ${headingNote}` : headingNote;
      }
    }

    // Citation Verification & Cross-Page Repair
    if (!finalExcerpt || !finalExcerpt.trim()) {
      requiresHumanReview = true;
      const note = `[Requires verification: Missing verbatim supporting excerpt.]`;
      rationale = rationale ? `${rationale} ${note}` : note;
    } else {
      // 1. Check reported page first
      const reportedSourcePage = reportedPage !== null ? pageMap.get(reportedPage) : undefined;
      const matchesReported = reportedSourcePage
        ? checkExcerptMatchesPage(reportedSourcePage.text, finalExcerpt)
        : false;

      if (matchesReported) {
        finalPageNumber = reportedPage;
      } else {
        // 2. Search all processed source pages for the excerpt
        const candidatePages: ExtractedPage[] = [];
        for (const p of usablePages) {
          if (checkExcerptMatchesPage(p.text, finalExcerpt)) {
            candidatePages.push(p);
          }
        }

        if (candidatePages.length === 1) {
          // Exactly one page matches: repair citation!
          const singleMatch = candidatePages[0]!;
          finalPageNumber = singleMatch.pageNumber;
          const repairNote = `[Citation repaired: Reported page ${reportedPage ?? "none"} corrected to page ${finalPageNumber} based on verified excerpt match.]`;
          rationale = rationale ? `${rationale} ${repairNote}` : repairNote;
        } else if (candidatePages.length === 0) {
          // Zero pages match: preserve original, flag for human review
          requiresHumanReview = true;
          const noMatchNote =
            reportedPage !== null
              ? `[Requires verification: Excerpt could not be verified verbatim against page ${reportedPage} text or any other processed page.]`
              : `[Requires verification: Excerpt could not be verified on any processed page.]`;
          rationale = rationale ? `${rationale} ${noMatchNote}` : noMatchNote;
        } else {
          // Multiple pages match: ambiguous match! Preserve original, flag for human review
          requiresHumanReview = true;
          const ambigPages = candidatePages.map((p) => p.pageNumber).join(", ");
          const ambigNote = `[Requires verification: Excerpt was ambiguously found on multiple pages (${ambigPages}); unable to deterministically verify cited page.]`;
          rationale = rationale ? `${rationale} ${ambigNote}` : ambigNote;
        }
      }
    }

    // Check OCR confidence of the final resolved source page
    const finalSourcePage = finalPageNumber !== null ? pageMap.get(finalPageNumber) : undefined;
    if (finalSourcePage) {
      const isLowConfidence =
        finalSourcePage.requiresHumanReview === true ||
        finalSourcePage.ocrStatus === "low_confidence" ||
        (typeof finalSourcePage.confidence === "number" && finalSourcePage.confidence < 40);

      if (isLowConfidence) {
        requiresHumanReview = true;
        const confStr =
          typeof finalSourcePage.confidence === "number"
            ? ` (${finalSourcePage.confidence}% confidence)`
            : "";
        const note = `[Requires verification: Source page ${finalPageNumber} was extracted via OCR with low confidence${confStr}.]`;
        rationale = rationale ? `${rationale} ${note}` : note;
      }
    } else if (finalPageNumber === null) {
      requiresHumanReview = true;
      const note = `[Requires verification: Requirement is missing a valid source page citation.]`;
      rationale = rationale ? `${rationale} ${note}` : note;
    }

    // Match requirement page number against detected sections
    const matchingSection = sections.find(
      (s) =>
        finalPageNumber !== null &&
        finalPageNumber >= s.pageRange[0] &&
        finalPageNumber <= s.pageRange[1],
    );
    const sectionId = matchingSection?.id;
    const sectionTitle = matchingSection?.title;

    if (documentType === "unknown") {
      requiresHumanReview = true;
      const note = `[Requires verification: Document classification is unknown.]`;
      rationale = rationale ? `${rationale} ${note}` : note;
    }

    return {
      id: `req-${index + 1}`,
      title,
      category,
      mandatory,
      normalizedCondition: r.normalizedCondition || title,
      source: {
        documentId: filename,
        pageNumber: finalPageNumber,
        clauseNumber: r.clauseNumber || undefined,
        excerpt: finalExcerpt,
      },
      sectionId,
      sectionTitle,
      status: "UNKNOWN",
      matchedEvidenceIds: [],
      rationale,
      requiresHumanReview,
      review: "pending",
    };
  });

  return {
    extractionId,
    filename,
    pageCount: totalPageCount,
    analyzedPageCount,
    processedPageCount: options?.processedPageCount ?? analyzedPageCount,
    attemptedPageCount: options?.attemptedPageCount ?? analyzedPageCount,
    unprocessedPages: unprocessedPages.length > 0 ? unprocessedPages : undefined,
    ...(options?.ocrPageLimit !== undefined ? { ocrPageLimit: options.ocrPageLimit } : {}),
    extractionStatus,
    ocrStatus,
    ocrConfidenceAvg,
    lowConfidencePages: lowConfidencePages.length > 0 ? lowConfidencePages : undefined,
    totalCharacters,
    metadata: finalMetadata,
    documentType,
    sections,
    contractualDurations: deadlineSeparation.contractualDurations,
    requirements,
    warnings: allWarnings,
    llmModel: provider.model,
    analyzedAt: new Date().toISOString(),
    profiling: profiling.length > 0 ? profiling : undefined,
  };
}
