import type { Assessment, TenderAnalysisResult } from "@/types/tender";

export interface PageCoverage {
  totalPages: number | undefined;
  processedPages: number | undefined;
  attemptedPages: number | undefined;
  remainingPages: number | undefined;
  ocrPageLimit: number | undefined;
  isPartial: boolean;
}

function validCount(value: number | undefined, total?: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  if (total !== undefined && value > total) return undefined;
  return value;
}

export function getPageCoverage(
  source: Pick<
    Assessment | TenderAnalysisResult,
    | "pageCount"
    | "processedPageCount"
    | "attemptedPageCount"
    | "analyzedPageCount"
    | "unprocessedPages"
    | "extractionStatus"
    | "ocrPageLimit"
  >,
): PageCoverage {
  const totalPages = validCount(source.pageCount);
  const listedRemaining = source.unprocessedPages?.filter(
    (page) => Number.isInteger(page) && page > 0,
  ).length;
  const processedPages =
    validCount(source.processedPageCount, totalPages) ??
    (totalPages !== undefined && listedRemaining !== undefined
      ? Math.max(0, totalPages - listedRemaining)
      : validCount(source.analyzedPageCount, totalPages));
  const attemptedPages = validCount(source.attemptedPageCount, totalPages);
  const remainingPages =
    totalPages !== undefined && processedPages !== undefined
      ? Math.max(0, totalPages - processedPages)
      : listedRemaining;

  return {
    totalPages,
    processedPages,
    attemptedPages,
    remainingPages,
    ocrPageLimit: validCount(source.ocrPageLimit),
    isPartial: source.extractionStatus === "partial_ocr" || (remainingPages ?? 0) > 0,
  };
}
