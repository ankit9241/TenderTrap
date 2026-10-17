import type { ExtractedPage } from "../pdf";
import type { ContractualDuration, DocumentSection, DocumentType } from "@/types/tender";

/**
 * Checks whether text describes a contractual duration, warranty, defect liability,
 * or performance guarantee validity period rather than a bid submission deadline.
 */
export function isContractualDuration(text: string): boolean {
  if (!text || !text.trim()) return false;
  const lower = text.toLowerCase().trim();

  // Explicit contractual duration patterns
  const contractualPatterns = [
    /beyond\s+(?:the\s+)?date\s+of\s+completion/i,
    /completion\s+of\s+(?:all\s+)?contractual\s+obligations/i,
    /defect\s+liability(?:\s+period)?/i,
    /warranty(?:\s+period)?/i,
    /maintenance\s+period/i,
    /performance\s+(?:guarantee|security)\s+(?:validity|shall\s+be\s+valid|period)/i,
    /validity\s+of\s+(?:pg|performance\s+guarantee|security\s+deposit)/i,
    /period\s+of\s+completion/i,
    /time\s+allowed\s+for\s+execution/i,
    /time\s+of\s+completion/i,
    /completion\s+period\s*(?:is|of|:)/i,
    /(?:minimum\s+)?period\s+of\s+\d+\s+(?:month|day|year)s?/i,
    /\b\d+\s+(?:month|day|year)s?\s+(?:from|after|beyond)\b/i,
    /as\s+per\s+gcc/i,
    /valid\s+up\s+to\s+\d+\s+months?\s+after/i,
  ];

  return contractualPatterns.some((p) => p.test(lower));
}

/**
 * Validates that text represents an actual calendar date or timestamp for bid submission.
 */
export function isValidBidSubmissionDeadline(text: string | null): boolean {
  if (!text || !text.trim()) return false;
  const trimmed = text.trim();

  // Rejects if it is a contractual duration
  if (isContractualDuration(trimmed)) return false;

  // Must contain date patterns: DD/MM/YYYY, YYYY-MM-DD, DD Month YYYY, etc.
  const hasDatePattern =
    /\b\d{1,2}[-/.](?:\d{1,2}|[a-zA-Z]{3,9})[-/.]\d{2,4}\b/.test(trimmed) ||
    /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{2,4})\b/i.test(trimmed) ||
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}\b/i.test(trimmed) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(trimmed);

  if (!hasDatePattern) {
    return false;
  }

  // Check for submission keywords or clean date format
  const lower = trimmed.toLowerCase();
  const submissionOrDateKeywords = [
    "submission",
    "due",
    "closing",
    "last date",
    "bid end",
    "receipt of",
    "hrs",
    "hours",
    "pm",
    "am",
    "date",
  ];

  const hasKeyword = submissionOrDateKeywords.some((kw) => lower.includes(kw));
  // If no keyword, but it is purely a clean date/timestamp string
  const isPureDateString = /^[\d\s\-/:.,apmt\u2013\u2014]+$/i.test(trimmed) || /^\d{1,2}\s+[a-z]{3,9}\s+\d{4}/i.test(trimmed);

  return hasKeyword || isPureDateString;
}

/**
 * Separates true bid submission deadlines from contractual durations.
 */
export function separateDeadlinesAndDurations(
  rawDeadline: string | null,
  importantDates?: Array<{ event: string; date: string }>,
  pageNumber: number | null = null,
): {
  bidSubmissionDeadline: string | null;
  contractualDurations: ContractualDuration[];
} {
  const contractualDurations: ContractualDuration[] = [];
  let bidSubmissionDeadline: string | null = null;

  if (rawDeadline && rawDeadline.trim()) {
    const trimmed = rawDeadline.trim();
    if (isContractualDuration(trimmed)) {
      contractualDurations.push({
        description: "Contractual duration / Guarantee validity",
        duration: trimmed,
        pageNumber,
      });
    } else if (isValidBidSubmissionDeadline(trimmed)) {
      bidSubmissionDeadline = trimmed;
    }
  }

  if (importantDates && Array.isArray(importantDates)) {
    for (const d of importantDates) {
      const eventText = `${d.event} ${d.date}`.trim();
      if (isContractualDuration(eventText) || isContractualDuration(d.date)) {
        contractualDurations.push({
          description: d.event || "Contractual duration",
          duration: d.date,
          pageNumber,
        });
      } else if (!bidSubmissionDeadline && /bid\s+submission|last\s+date|closing|due\s+date/i.test(d.event)) {
        if (isValidBidSubmissionDeadline(d.date)) {
          bidSubmissionDeadline = d.date;
        }
      }
    }
  }

  return { bidSubmissionDeadline, contractualDurations };
}

export interface PageHeaderDetection {
  documentType: DocumentType;
  title: string;
  reference?: string | null;
  authority?: string | null;
  confidence: number;
  uncertain?: boolean;
}

/**
 * Detects whether a page begins or represents a distinct document section using grounded page signals.
 */
export function detectPageHeader(pageText: string): PageHeaderDetection | null {
  if (!pageText || pageText.trim().length === 0) return null;

  // Take the first 1200 characters of the page for header analysis
  const topText = pageText.slice(0, 1200);
  const cleanTop = topText.replace(/\r?\n/g, " ");

  // 1. Genuine Notice Inviting Tender (NIT)
  const nitMatch =
    /\b(?:NOTICE\s+INVITING\s+TENDER|NOTICE\s+INVITING\s+E-TENDER|PRESS\s+NOTICE\s+INVITING\s+TENDER|INVITATION\s+FOR\s+BIDS|REQUEST\s+FOR\s+PROPOSAL|E-TENDER\s+NOTICE)\b/i.test(topText) ||
    /\bNIT\s+NO\.?\s*[:\s]?[A-Za-z0-9\/\-()_.]+/i.test(topText);

  if (nitMatch) {
    let title = "Notice Inviting Tender";
    const titleMatch = topText.match(/(?:NOTICE\s+INVITING\s+[^\n\r]+|INVITATION\s+FOR\s+BIDS[^\n\r]+|REQUEST\s+FOR\s+PROPOSAL[^\n\r]+)/i);
    if (titleMatch) {
      title = titleMatch[0].trim();
    }

    let reference: string | null = null;
    const refMatch = topText.match(/(?:NIT\s+No\.?|Tender\s+Ref\.?|Tender\s+ID)\s*[:\s]?([A-Za-z0-9\/\-()_.]+)/i);
    if (refMatch) {
      reference = refMatch[1]?.trim() || null;
    }

    let authority: string | null = null;
    const authMatch = topText.match(/(?:Municipal\s+Corporation\s+of\s+Delhi|CPWD|Public\s+Works\s+Department|Ministry\s+of\s+[^\n\r,]+|Addl\.\s+Commissioner[^\n\r,]*)/i);
    if (authMatch) {
      authority = authMatch[0].trim();
    }

    return {
      documentType: "tender_notice",
      title,
      reference,
      authority,
      confidence: 0.9,
    };
  }

  // 2. Corrigendum or Amendment
  const corrigendumMatch =
    /\b(?:CORRIGENDUM(?:\s+NO\.?)?|ADDENDUM(?:\s+NO\.?)?|AMENDMENT\s+TO\s+(?:NIT|TENDER)|EXTENSION\s+NOTICE|REVISED\s+SCHEDULE)\b/i.test(topText);

  if (corrigendumMatch) {
    let title = "Corrigendum / Amendment";
    const titleMatch = topText.match(/(?:CORRIGENDUM[^\n\r]*|ADDENDUM[^\n\r]*|EXTENSION\s+NOTICE[^\n\r]*)/i);
    if (titleMatch) {
      title = titleMatch[0].trim();
    }

    return {
      documentType: "amendment_or_corrigendum",
      title,
      confidence: 0.9,
    };
  }

  // Check if this page is an Annexure or explicit continuation of an existing section without a new circular dispatch
  const isAnnexure = /\bAnnexure\s*['"‘"]?[A-Z0-9]['"’”]?\b/i.test(topText);
  const isContinuation =
    /\b(?:In\s+continuation\s+to|Contd\.?|Continued\b)/i.test(topText) &&
    !/\b(?:CIRCULAR|OFFICE\s+ORDER|ORDER)\s*(?:No\.?)?\b/i.test(topText);

  if ((isAnnexure || isContinuation) && !/\b(?:CIRCULAR|OFFICE\s+ORDER|OFFICE\s+MEMORANDUM)\s*No/i.test(topText)) {
    return null;
  }

  // 3. Policy Circular, Office Order, or Office Memorandum
  // Check this BEFORE contract manual, because circulars often clarify or quote Works Manual paras (e.g. "Clarification- Para 5.2 of CPWD Works Manual 2024")
  const circularMatch =
    /\b(?:CIRCULAR(?:\s+NO\.?)?|OFFICE\s+MEMORANDUM|OFFICE\s+ORDER|POLICY\s+CIRCULAR|CLARIFICATION\s*[-—:]\s*PARA)\b/i.test(topText) ||
    (/\bORDER\b/i.test(topText) && /\b(?:MUNICIPAL\s+CORPORATION|ENGINEERING|EXECUTIVE\s+ENGINEER)\b/i.test(topText));

  if (circularMatch) {
    let docKind = "Circular";
    if (/\bOFFICE\s+ORDER\b/i.test(topText)) docKind = "Office Order";
    else if (/\bOFFICE\s+MEMORANDUM\b/i.test(topText)) docKind = "Office Memorandum";
    else if (/\bORDER\b/i.test(topText)) docKind = "Order";

    // Extract Subject (strictly using word boundary)
    let subject: string | null = null;
    const subMatch = topText.match(/\b(?:SUB(?:JECT)?|Subject)\b\s*[:\-—\s]*\s*([^\r\n]+)/i);
    if (subMatch) {
      subject = subMatch[1]
        .trim()
        .replace(/^[-—:\s]+/, "")
        .replace(/\s+/g, " ");
    }

    // Extract Dispatch / Ref
    let reference: string | null = null;
    const refMatch = topText.match(
      /(?:No\.?|Ref\.?|Number)\s*[:\-—\s]*\s*([A-Za-z0-9][A-Za-z0-9\/\-()_.\s|]+?)(?=\s+(?:Dated?|Date\b|CIRCULAR|OFFICE|SUB|Subject|$|[\r\n]))/i,
    );
    if (refMatch) {
      reference = refMatch[1].trim().replace(/\s+/g, " ");
    }

    let authority: string | null = null;
    const authMatch = topText.match(
      /(?:Municipal\s+Corporation\s+of\s+Delhi|CPWD|Public\s+Works\s+Department|Ministry\s+of\s+[^\n\r,]+|Addl\.\s+Commissioner[^\n\r,]*|Engineering\s+Department\s*\(HQ\))/i,
    );
    if (authMatch) {
      authority = authMatch[0].trim();
    }

    let title = subject ? `${docKind}: ${subject}` : `${docKind} / Office Memorandum`;
    if (!subject && reference) {
      title = `${docKind} (Ref: ${reference})`;
    }

    return {
      documentType: "circular_or_policy",
      title,
      reference,
      authority,
      confidence: 0.9,
    };
  }

  // 4. Contract Conditions / Manuals (CPWD GCC / Works Manual clauses)
  const isContractManualHeading =
    /\b(?:GENERAL\s+CONDITIONS\s+OF\s+CONTRACT|SPECIAL\s+CONDITIONS\s+OF\s+CONTRACT|CPWD\s+WORKS\s+MANUAL|STANDARD\s+BIDDING\s+DOCUMENT|CLAUSES\s+OF\s+CONTRACT)\b/i.test(topText);
  const gccClauseRegex = /\bClause\s+(\d+[A-Z]?)\b(?:\s+([A-Za-z\s]+?)(?=\s+No\s+payment|\s+The\s+|\s+If\s+|\s+All\s+|[\r\n]))?/i;
  const clauseMatch = topText.match(gccClauseRegex);

  // If text starts with or features Clause \d+ discussing contractual payment/obligations without being an administrative order
  const hasCircularDispatch =
    /(?:CIRCULAR|OFFICE\s+ORDER|OFFICE\s+MEMORANDUM|ORDER)\b/i.test(topText) &&
    /(?:No\.?|Ref\.?|Dated?)\s*[:\-—]/i.test(topText);

  if (
    !hasCircularDispatch &&
    (isContractManualHeading ||
      (clauseMatch &&
        /\b(?:intermediate|payment|contract|contractor|completion|advance|certificate|engineer-in-charge|running\s+account|bill)\b/i.test(cleanTop)))
  ) {
    let title = "General Conditions of Contract / Works Manual";
    if (clauseMatch) {
      const clauseName = clauseMatch[2] ? clauseMatch[2].trim() : "";
      title = clauseName
        ? `General Conditions of Contract (Clause ${clauseMatch[1]}: ${clauseName})`
        : `General Conditions of Contract (Clause ${clauseMatch[1]})`;
    }
    return {
      documentType: "contract_conditions",
      title,
      confidence: 0.9,
    };
  }

  return null;
}

export interface DocumentClassificationResult {
  overallType: DocumentType;
  sections: DocumentSection[];
  warnings: string[];
  isCompilation: boolean;
}

/**
 * Classifies an entire multi-page document and extracts section boundaries.
 * Preserves section ranges and ensures compilations are never treated as a single tender notice.
 */
export function classifyDocumentAndSections(pages: ExtractedPage[]): DocumentClassificationResult {
  if (!pages || pages.length === 0) {
    return {
      overallType: "unknown",
      sections: [],
      warnings: ["No pages provided for classification."],
      isCompilation: false,
    };
  }

  const detectedSections: Array<{
    pageNumber: number;
    detection: PageHeaderDetection;
  }> = [];

  let inContractManual = false;

  for (const page of pages) {
    if (!page.text || !page.text.trim()) continue;

    // Once in a contract manual (e.g. CPWD GCC clauses), subsequent pages containing
    // clauses, continuations, or bilingual translations remain part of that contract manual section
    if (inContractManual) {
      const detection = detectPageHeader(page.text);
      // Switch away from contract manual if a distinct document type (tender notice, corrigendum, or circular) is detected
      if (detection && detection.documentType !== "contract_conditions") {
        inContractManual = false;
        detectedSections.push({ pageNumber: page.pageNumber, detection });
      }
      continue;
    }

    const detection = detectPageHeader(page.text);
    if (detection) {
      if (detection.documentType === "contract_conditions") {
        inContractManual = true;
      }
      detectedSections.push({
        pageNumber: page.pageNumber,
        detection,
      });
    }
  }

  const totalPageCount = pages.reduce((max, p) => Math.max(max, p.pageNumber), pages.length);
  const sections: DocumentSection[] = [];
  const warnings: string[] = [];

  if (detectedSections.length === 0) {
    // Check whole text fallback if page headers didn't match cleanly
    const sampleText = pages.slice(0, 3).map((p) => p.text || "").join(" ").slice(0, 3000);
    let fallbackType: DocumentType = "unknown";

    if (/circular|office\s+memorandum/i.test(sampleText)) {
      fallbackType = "circular_or_policy";
    } else if (/conditions\s+of\s+contract|works\s+manual|clauses\s+of\s+contract/i.test(sampleText)) {
      fallbackType = "contract_conditions";
    } else if (/corrigendum|addendum/i.test(sampleText)) {
      fallbackType = "amendment_or_corrigendum";
    } else if (/notice\s+inviting\s+tender|tender\s+notice/i.test(sampleText)) {
      fallbackType = "tender_notice";
    }

    sections.push({
      id: "sec-1",
      title: fallbackType === "unknown" ? "Document" : fallbackType.replace(/_/g, " "),
      documentType: fallbackType,
      pageRange: [1, totalPageCount],
    });

    if (fallbackType === "unknown") {
      warnings.push("Document type could not be reliably classified. Human review is recommended.");
    }

    return {
      overallType: fallbackType,
      sections,
      warnings,
      isCompilation: false,
    };
  }

  // Convert detected boundaries into explicit non-overlapping page ranges [start, end]
  for (let i = 0; i < detectedSections.length; i++) {
    const current = detectedSections[i]!;
    const next = detectedSections[i + 1];
    const endPage = next ? next.pageNumber - 1 : totalPageCount;

    sections.push({
      id: `sec-${i + 1}`,
      title: current.detection.title,
      documentType: current.detection.documentType,
      pageRange: [current.pageNumber, Math.max(current.pageNumber, endPage)],
      reference: current.detection.reference || null,
      authority: current.detection.authority || null,
    });

    if (current.detection.uncertain) {
      warnings.push(`Section '${current.detection.title}' (page ${current.pageNumber}) has uncertain boundaries and requires human review.`);
    }
  }

  // Ensure initial pages before the first detected section (if any) are accounted for
  if (detectedSections[0]!.pageNumber > 1) {
    sections.unshift({
      id: "sec-0",
      title: "Preliminary Pages",
      documentType: "unknown",
      pageRange: [1, detectedSections[0]!.pageNumber - 1],
    });
  }

  // Determine overall document type
  const uniqueTypes = new Set(sections.map((s) => s.documentType).filter((t) => t !== "unknown"));
  const isCompilation = detectedSections.length > 1 || uniqueTypes.size > 1;

  let overallType: DocumentType;
  if (uniqueTypes.size === 1) {
    const singleType = Array.from(uniqueTypes)[0]!;
    if (detectedSections.length > 1) {
      overallType = "mixed_compilation";
      warnings.push(`Document contains ${detectedSections.length} separate ${singleType.replace(/_/g, " ")} sections compiled together.`);
    } else {
      overallType = singleType;
    }
  } else if (uniqueTypes.size > 1) {
    overallType = "mixed_compilation";
    const typeList = Array.from(uniqueTypes).map((t) => t.replace(/_/g, " ")).join(", ");
    warnings.push(`Document is a compilation of multiple distinct document types: ${typeList}. Sections have been separated by page range.`);
  } else {
    overallType = "unknown";
    warnings.push("Document could not be reliably classified. Treated as unknown requiring human review.");
  }

  // Special warning for non-tender documents
  if (overallType !== "tender_notice") {
    warnings.push(
      `Document is classified as '${overallType}', not an active tender notice. Extracted clauses represent administrative policies, general contract conditions, or compilation rules rather than confirmed tender qualification criteria.`,
    );
  }

  return {
    overallType,
    sections,
    warnings,
    isCompilation,
  };
}
