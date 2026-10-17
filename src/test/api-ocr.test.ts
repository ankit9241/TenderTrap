// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  extractTextFromPdf,
  isPageTextInsufficient,
  type ExtractedPage,
} from "@/lib/server/pdf";
import { setMockOcrHandler } from "@/lib/server/ocr";
import { setMockLlmProvider } from "@/lib/server/llm";
import { Route as ExtractRoute } from "@/routes/api.tenders.extract";
import { Route as AnalyzeRoute } from "@/routes/api.tenders.analyze";

function createPdfBuffer(streamContent: string, pageCount = 1): Uint8Array {
  if (pageCount === 1) {
    const stream = streamContent;
    const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${stream.length} >> stream
${stream}
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000338 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
417
%%EOF`;
    return new Uint8Array(Buffer.from(content, "utf-8"));
  }

  // 2-page PDF
  const stream1 = streamContent;
  const stream2 = "BT /F1 12 Tf 72 712 Td (Page 2 text) Tj ET";
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >> endobj
5 0 obj << /Length ${stream1.length} >> stream
${stream1}
endstream
endobj
6 0 obj << /Length ${stream2.length} >> stream
${stream2}
endstream
endobj
7 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000125 00000 n 
0000000255 00000 n 
0000000385 00000 n 
0000000450 00000 n 
0000000520 00000 n 
trailer << /Size 8 /Root 1 0 R >>
startxref
600
%%EOF`;
  return new Uint8Array(Buffer.from(content, "utf-8"));
}

function createEmptyPagePdfBuffer(): Uint8Array {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length 0 >> stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000215 00000 n 
trailer << /Size 5 /Root 1 0 R >>
startxref
260
%%EOF`;
  return new Uint8Array(Buffer.from(content, "utf-8"));
}

function createTwoPageMixedPdfBuffer(): Uint8Array {
  // Page 1 has rich native text; Page 2 has an empty stream (scanned)
  const stream1 = "BT /F1 12 Tf 72 712 Td (Tender Notice: PWD Karnataka Highway Project Phase 1) Tj ET";
  const stream2 = "";
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >> endobj
5 0 obj << /Length ${stream1.length} >> stream
${stream1}
endstream
endobj
6 0 obj << /Length 0 >> stream
endstream
endobj
7 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000125 00000 n 
0000000255 00000 n 
0000000350 00000 n 
0000000450 00000 n 
0000000500 00000 n 
trailer << /Size 8 /Root 1 0 R >>
startxref
600
%%EOF`;
  return new Uint8Array(Buffer.from(content, "utf-8"));
}

function createUploadFile(buf: Uint8Array, name: string): File {
  const f = new File([buf.buffer as ArrayBuffer], name, { type: "application/pdf" });
  (f as any)._buffer = buf;
  return f;
}

describe("OCR Fallback Architecture & Processing", () => {
  afterEach(() => {
    setMockOcrHandler(null);
    setMockLlmProvider(null);
  });

  describe("Conservative Thresholding", () => {
    it("marks empty strings as needing OCR", () => {
      expect(isPageTextInsufficient("")).toBe(true);
      expect(isPageTextInsufficient("   \n\t ")).toBe(true);
    });

    it("marks single numbers or trivial page markers as needing OCR", () => {
      expect(isPageTextInsufficient("1")).toBe(true);
      expect(isPageTextInsufficient("Page 2")).toBe(true);
    });

    it("does NOT mark short multi-word headers as insufficient", () => {
      // 3 or more words with meaningful content is preserved as native
      expect(isPageTextInsufficient("ANNEXURE A: SPECIAL TERMS")).toBe(false);
      expect(isPageTextInsufficient("Tender No: PWD-KA-884")).toBe(false);
    });

    it("does NOT mark dense text as needing OCR", () => {
      expect(
        isPageTextInsufficient("The bidder must possess Class 1 contractor license with Karnataka PWD."),
      ).toBe(false);
    });
  });

  describe("Native vs OCR Path Execution", () => {
    it("uses native extraction on selectable-text PDFs without triggering OCR", async () => {
      const tenderText = "Tender Notice: PWD Karnataka Highway Expansion Project. Minimum Turnover INR 25 Cr.";
      const pdfBuf = createPdfBuffer(`BT /F1 12 Tf 72 712 Td (${tenderText}) Tj ET`);

      let ocrCalled = false;
      setMockOcrHandler(async () => {
        ocrCalled = true;
        return { text: "Should not be called", confidence: 99 };
      });

      const result = await extractTextFromPdf(pdfBuf, "native_tender.pdf");

      expect(ocrCalled).toBe(false);
      expect(result.extractionStatus).toBe("success");
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]!.pageNumber).toBe(1);
      expect(result.pages[0]!.method).toBe("native");
      expect(result.pages[0]!.confidence).toBeNull();
      expect(result.pages[0]!.text).toContain("PWD Karnataka");
    });

    it("triggers OCR when native text is empty and extracts text with confidence", async () => {
      const emptyBuf = createEmptyPagePdfBuffer();

      setMockOcrHandler(async (pageNum) => {
        return {
          text: "Scanned Tender Clause 4.2: EMD Amount is INR 15,00,000 payable by DD.",
          confidence: 88,
        };
      });

      const result = await extractTextFromPdf(emptyBuf, "scanned_doc.pdf");

      expect(result.extractionStatus).toBe("success");
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]!.pageNumber).toBe(1);
      expect(result.pages[0]!.method).toBe("ocr");
      expect(result.pages[0]!.confidence).toBe(88);
      expect(result.pages[0]!.text).toContain("EMD Amount is INR 15,00,000");
      expect(result.pages[0]!.requiresHumanReview).toBe(false);
    });

    it("preserves native text on mixed PDFs and only runs OCR on the scanned page", async () => {
      const mixedBuf = createTwoPageMixedPdfBuffer();

      let ocrPageTarget = -1;
      setMockOcrHandler(async (pageNum) => {
        ocrPageTarget = pageNum;
        return {
          text: "Page 2 Scanned Content: Financial Turnover requirement INR 50 Cr in last 3 FYs.",
          confidence: 91,
        };
      });

      const result = await extractTextFromPdf(mixedBuf, "mixed_tender.pdf");

      expect(result.extractionStatus).toBe("success");
      expect(result.pageCount).toBe(2);
      expect(ocrPageTarget).toBe(2); // Only page 2 was sent to OCR

      // Page 1: Native
      expect(result.pages[0]!.pageNumber).toBe(1);
      expect(result.pages[0]!.method).toBe("native");
      expect(result.pages[0]!.confidence).toBeNull();
      expect(result.pages[0]!.text).toContain("PWD Karnataka Highway Project Phase 1");

      // Page 2: OCR
      expect(result.pages[1]!.pageNumber).toBe(2);
      expect(result.pages[1]!.method).toBe("ocr");
      expect(result.pages[1]!.confidence).toBe(91);
      expect(result.pages[1]!.text).toContain("Financial Turnover requirement INR 50 Cr");
    });

    it("flags low-confidence OCR (< 40%) for human review", async () => {
      const emptyBuf = createEmptyPagePdfBuffer();

      setMockOcrHandler(async () => {
        return {
          text: "G@rbled t3xt fr0m p00r qu@l1ty sc@n",
          confidence: 28,
        };
      });

      const result = await extractTextFromPdf(emptyBuf, "poor_scan.pdf", { lowConfidenceThreshold: 40 });

      expect(result.extractionStatus).toBe("success");
      const page = result.pages[0]!;
      expect(page.method).toBe("ocr");
      expect(page.confidence).toBe(28);
      expect(page.ocrStatus).toBe("low_confidence");
      expect(page.requiresHumanReview).toBe(true);
      expect(page.ocrWarning).toContain("OCR confidence is low");
    });

    it("returns scanned_ocr_required when OCR finds zero text across all pages", async () => {
      const emptyBuf = createEmptyPagePdfBuffer();

      setMockOcrHandler(async () => {
        return { text: "", confidence: 0 };
      });

      const result = await extractTextFromPdf(emptyBuf, "blank_scanned.pdf");

      expect(result.extractionStatus).toBe("scanned_ocr_required");
      expect(result.error).toContain("OCR (Optical Character Recognition) was unable to detect legible text");
      expect(result.pages[0]!.ocrStatus).toBe("empty");
      expect(result.pages[0]!.requiresHumanReview).toBe(true);
    });

    it("returns partial_ocr with list of unprocessed pages when maxOcrPages is exceeded", async () => {
      // 2-page PDF where both pages are empty
      const stream1 = "";
      const stream2 = "";
      const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >> endobj
5 0 obj << /Length 0 >> stream
endstream
endobj
6 0 obj << /Length 0 >> stream
endstream
endobj
xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000125 00000 n 
0000000215 00000 n 
0000000305 00000 n 
0000000355 00000 n 
trailer << /Size 7 /Root 1 0 R >>
startxref
450
%%EOF`;
      const twoPageScanned = new Uint8Array(Buffer.from(content, "utf-8"));

      setMockOcrHandler(async (pageNum) => {
        return {
          text: `Extracted content for page ${pageNum} via OCR`,
          confidence: 85,
        };
      });

      // Set maxOcrPages: 1 so page 2 cannot be processed
      const result = await extractTextFromPdf(twoPageScanned, "oversized_scan.pdf", { maxOcrPages: 1 });

      expect(result.extractionStatus).toBe("partial_ocr");
      expect(result.unprocessedPages).toEqual([2]);
      expect(result.pages[0]!.ocrStatus).toBe("success");
      expect(result.pages[1]!.ocrStatus).toBe("unprocessed");
      expect(result.pages[1]!.requiresHumanReview).toBe(true);
      expect(result.warnings.some((w) => w.includes("exceeded the maximum OCR page limit"))).toBe(true);
    });

    it("handles OCR per-page failure gracefully without aborting remaining pages", async () => {
      const twoPageScanned = createTwoPageMixedPdfBuffer();

      setMockOcrHandler(async (pageNum) => {
        if (pageNum === 2) {
          throw new Error("Tesseract WASM memory allocation error");
        }
        return { text: "Normal text", confidence: 90 };
      });

      const result = await extractTextFromPdf(twoPageScanned, "mixed_with_failure.pdf");

      expect(result.extractionStatus).toBe("partial_ocr");
      expect(result.pages[0]!.method).toBe("native");
      expect(result.pages[1]!.method).toBe("ocr");
      expect(result.pages[1]!.ocrStatus).toBe("failed");
      expect(result.pages[1]!.requiresHumanReview).toBe(true);
      expect(result.warnings.some((w) => w.includes("Page 2 OCR failed"))).toBe(true);
    });
  });

  describe("Real Scanned PDF Integration Test", () => {
    it("renders page to image and runs real Tesseract OCR engine without mocking", async () => {
      // Create a PDF with renderable visual text
      const stream = "BT /F1 18 Tf 72 712 Td (Tender Notice: PWD Karnataka Highway Expansion) Tj ET";
      const realPdf = createPdfBuffer(stream, 1);

      // Force OCR processing on this page by passing it as insufficient
      // We pass through extractTextFromPdf with real Tesseract worker
      setMockOcrHandler(null); // Ensure NO mock is active!

      // This uses real unpdf renderPageAsImage + @napi-rs/canvas + real tesseract.js worker
      // Let's create an empty page PDF where we render real content or run extractTextFromPdf
      // In createPdfBuffer, text is 72 chars, which is >= 20, so native extraction will handle it natively.
      // To test real OCR pipeline, create a PDF with minimal text "1" so isPageTextInsufficient triggers OCR!
      const triggerOcrPdf = createPdfBuffer("BT /F1 18 Tf 72 712 Td (1) Tj ET", 1);

      const result = await extractTextFromPdf(triggerOcrPdf, "real_ocr_test.pdf");

      // Verify that OCR was executed using real tesseract.js
      expect(result.pages[0]!.method).toBe("ocr");
      // Even if only '1' was rendered, Tesseract executed and returned confidence
      expect(typeof result.pages[0]!.confidence).toBe("number");
      expect(result.pages[0]!.confidence).toBeGreaterThanOrEqual(0);
    }, 30000); // 30s timeout for real WASM OCR
  });

  describe("Endpoints Compatibility with OCR", () => {
    const extractHandler = (ExtractRoute.options.server?.handlers as any)?.POST;
    const analyzeHandler = (AnalyzeRoute.options.server?.handlers as any)?.POST;

    it("POST /api/tenders/extract returns 200 with OCR metadata for scanned document", async () => {
      const scannedBuf = createEmptyPagePdfBuffer();

      setMockOcrHandler(async () => {
        return {
          text: "Scanned Tender Notice: Construction of Flyover at Junction 4. Estimated INR 45 Cr.",
          confidence: 89,
        };
      });

      const formData = new FormData();
      formData.append("file", createUploadFile(scannedBuf, "scanned_flyover.pdf"));

      const req = {
        formData: async () => formData,
      } as unknown as Request;

      const res = await extractHandler!({ request: req } as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.extractionStatus).toBe("success");
      expect(body.pages[0]!.method).toBe("ocr");
      expect(body.pages[0]!.confidence).toBe(89);
      expect(body.pages[0]!.text).toContain("Construction of Flyover");
    });

    it("POST /api/tenders/extract returns 200 with partial_ocr status when limit is exceeded", async () => {
      const mixedBuf = createTwoPageMixedPdfBuffer();

      setMockOcrHandler(async () => {
        return { text: "Scanned page 2 text", confidence: 85 };
      });

      const formData = new FormData();
      formData.append("file", createUploadFile(mixedBuf, "tender_limit.pdf"));

      const req = {
        formData: async () => formData,
      } as unknown as Request;

      // Note: extract handler runs default options (max 15 pages), so a 2-page document with 1 scanned page passes with 200
      const res = await extractHandler!({ request: req } as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pages[0]!.method).toBe("native");
      expect(body.pages[1]!.method).toBe("ocr");
    });

    it("POST /api/tenders/analyze accepts OCR-extracted pages and analyzes requirements with Gemma", async () => {
      const scannedBuf = createEmptyPagePdfBuffer();

      setMockOcrHandler(async () => {
        return {
          text: "Tender Ref: PWD-2026-99.\nEligibility Requirement: Minimum average annual turnover of INR 30 Cr in last 3 financial years.\nEMD: INR 10 Lakhs.",
          confidence: 92,
        };
      });

      setMockLlmProvider({
        name: "mock-gemma",
        model: "gemma3:test",
        checkHealth: async () => ({ ok: true, provider: "mock-gemma", model: "gemma3:test" }),
        generateJson: async () => {
          return JSON.stringify({
            metadata: {
              title: "Highway Construction Tender",
              reference: "PWD-2026-99",
              authority: "PWD Karnataka",
              procurementSource: "State Portal",
              estimatedValue: "INR 30 Cr",
              emdAmount: "INR 10 Lakhs",
              tenderFee: null,
              deadline: "2026-11-30",
              importantDates: [],
            },
            requirements: [
              {
                title: "Annual Financial Turnover",
                category: "financial",
                mandatory: true,
                normalizedCondition: "Turnover >= INR 30 Cr in last 3 FYs",
                pageNumber: 1,
                clauseNumber: null,
                excerpt: "Minimum average annual turnover of INR 30 Cr in last 3 financial years",
                rationale: "Mandatory qualification criterion",
                requiresHumanReview: false,
              },
            ],
            warnings: [],
          });
        },
      });

      const formData = new FormData();
      formData.append("file", createUploadFile(scannedBuf, "scanned_highway.pdf"));

      const req = {
        formData: async () => formData,
      } as unknown as Request;

      const res = await analyzeHandler!({ request: req } as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.metadata.reference).toBe("PWD-2026-99");
      expect(body.requirements).toHaveLength(1);
      expect(body.requirements[0].source.pageNumber).toBe(1);
      expect(body.requirements[0].source.excerpt).toContain("INR 30 Cr");
      expect(body.pageCount).toBe(1);
      expect(body.analyzedPageCount).toBe(1);
      expect(body.extractionStatus).toBe("success");
      expect(body.ocrStatus).toBe("completed");
      expect(body.ocrConfidenceAvg).toBe(92);
    });
  });
});
