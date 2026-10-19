import { describe, expect, it } from "vitest";
import { getPageCoverage } from "@/lib/assessment/coverage";

describe("page coverage", () => {
  it("uses processed pages as the source of truth for remaining pages", () => {
    expect(
      getPageCoverage({
        pageCount: 157,
        processedPageCount: 10,
        attemptedPageCount: 15,
        analyzedPageCount: 15,
        unprocessedPages: Array.from({ length: 147 }, (_, index) => index + 11),
        extractionStatus: "partial_ocr",
        ocrPageLimit: 15,
      }),
    ).toMatchObject({
      totalPages: 157,
      processedPages: 10,
      attemptedPages: 15,
      remainingPages: 147,
      ocrPageLimit: 15,
      isPartial: true,
    });
  });

  it("derives legacy processed coverage from a valid unprocessed page list", () => {
    expect(
      getPageCoverage({
        pageCount: 157,
        analyzedPageCount: 10,
        unprocessedPages: Array.from({ length: 142 }, (_, index) => index + 16),
        extractionStatus: "partial_ocr",
      }),
    ).toMatchObject({ processedPages: 15, remainingPages: 142 });
  });

  it("does not invent counts when legacy metadata is incomplete", () => {
    expect(
      getPageCoverage({
        extractionStatus: "partial_ocr",
      }),
    ).toMatchObject({
      totalPages: undefined,
      processedPages: undefined,
      attemptedPages: undefined,
      remainingPages: undefined,
    });
  });
});
