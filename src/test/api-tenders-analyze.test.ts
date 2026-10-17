// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Route } from "@/routes/api.tenders.analyze";
import { setMockLlmProvider, analyzeTenderPages, isTitleOnlyExcerpt, findOperativeSentenceOnPage } from "@/lib/server/llm";
import type { LlmProvider, LlmMessage } from "@/lib/server/llm/types";
import type { ExtractedPage } from "@/lib/server/pdf";
import type { TenderRequirement } from "@/types/tender";
import {
  isLanguageSupported,
  MIN_PAGE_TIMEOUT_MS,
  HARD_MAX_PAGE_TIMEOUT_MS,
  DEFAULT_PER_PAGE_TIMEOUT_MS,
} from "@/lib/server/ocr";
import { decide, effectiveStatus } from "@/lib/assessment/decide";
import { isRequirementLinkedToDocument, linkRequirementsToDocument } from "@/lib/assessment/match";
import {
  isContractualDuration,
  isValidBidSubmissionDeadline,
  classifyDocumentAndSections,
} from "@/lib/server/llm/classification";

function createValidPdfBuffer(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 712 Td (${text}) Tj ET`;
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

function createScannedPdfBuffer(): Uint8Array {
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

function createUploadFile(buf: Uint8Array, name: string, type: string): File {
  const f = new File([buf.buffer as ArrayBuffer], name, { type });
  (f as any)._buffer = buf;
  return f;
}

describe("POST /api/tenders/analyze — Gemma Requirement Extraction", () => {
  const handler = (Route.options.server?.handlers as any)?.POST;

  beforeEach(() => {
    setMockLlmProvider(null);
  });

  afterEach(() => {
    setMockLlmProvider(null);
  });

  it("successfully extracts structured requirements and tender metadata", async () => {
    const mockJson = JSON.stringify({
      metadata: {
        title: "Expansion of NH-48 Highway",
        reference: "NHAI/2026/HW-48",
        authority: "National Highways Authority of India",
        procurementSource: "GeM",
        estimatedValue: "INR 45,00,00,000",
        emdAmount: "INR 45,00,000",
        tenderFee: "INR 10,000",
        deadline: "2026-11-15T15:00:00.000Z",
        importantDates: [{ event: "Bid Deadline", date: "2026-11-15" }],
      },
      requirements: [
        {
          title: "Minimum Annual Turnover",
          category: "financial",
          mandatory: true,
          normalizedCondition: "Annual turnover >= INR 25 Cr in past 3 FYs",
          pageNumber: 1,
          clauseNumber: "Clause 3.2.1",
          excerpt: "Average annual financial turnover during the last 3 years should be at least INR 25 Crores",
          rationale: "Financial solvency threshold",
          requiresHumanReview: false,
        },
        {
          title: "Class 1 Highway Contractor License",
          category: "registration",
          mandatory: true,
          normalizedCondition: "Valid Class 1 PWD/CPWD registration",
          pageNumber: 1,
          clauseNumber: "Clause 2.1",
          excerpt: "Bidders must possess valid Class 1 contractor license issued by State PWD or CPWD",
          rationale: "Statutory registration requirement",
          requiresHumanReview: false,
        },
      ],
      warnings: [],
    });

    const mockProvider: LlmProvider = {
      name: "mock-ollama",
      model: "gemma3:latest",
      generateJson: async () => mockJson,
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const formData = new FormData();
    const pdfBuf = createValidPdfBuffer("National Highways Authority of India Tender for NH-48 Highway Construction");
    formData.append("file", createUploadFile(pdfBuf, "nhai_tender.pdf", "application/pdf"));

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.extractionId).toMatch(/^ext-/);
    expect(body.filename).toBe("nhai_tender.pdf");
    expect(body.metadata.title).toBe("Expansion of NH-48 Highway");
    expect(body.metadata.authority).toBe("National Highways Authority of India");
    expect(body.metadata.emdAmount).toBe("INR 45,00,000");

    expect(body.requirements).toHaveLength(2);
    expect(body.requirements[0].title).toBe("Minimum Annual Turnover");
    expect(body.requirements[0].category).toBe("financial");
    expect(body.requirements[0].status).toBe("UNKNOWN");
    expect(body.requirements[0].source.pageNumber).toBe(1);
    expect(body.requirements[0].source.excerpt).toContain("INR 25 Crores");

    expect(body.requirements[1].title).toBe("Class 1 Highway Contractor License");
    expect(body.requirements[1].category).toBe("registration");
    expect(body.requirements[1].status).toBe("UNKNOWN");

    // Coverage metadata for native PDF
    expect(body.pageCount).toBe(1);
    expect(body.analyzedPageCount).toBe(1);
    expect(body.extractionStatus).toBe("success");
    expect(body.ocrStatus).toBe("not_needed");
  });

  it("returns 502 Bad Gateway when LLM returns malformed non-JSON output", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-ollama",
      model: "gemma3:latest",
      generateJson: async () => "Error: Sorry, I am unable to format this as JSON.",
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const formData = new FormData();
    const pdfBuf = createValidPdfBuffer("Tender text for testing malformed output response");
    formData.append("file", createUploadFile(pdfBuf, "tender.pdf", "application/pdf"));

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error).toContain("invalid response structure");
  });

  it("returns 504 Gateway Timeout when model generation exceeds timeout", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-ollama",
      model: "gemma3:latest",
      generateJson: async () => {
        throw new Error("Ollama generation timed out after 90 seconds");
      },
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const formData = new FormData();
    const pdfBuf = createValidPdfBuffer("Tender text for testing timeout handling in pipeline");
    formData.append("file", createUploadFile(pdfBuf, "tender.pdf", "application/pdf"));

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(504);

    const body = await res.json();
    expect(body.error).toContain("timed out");
  });

  it("returns 503 Service Unavailable when Ollama provider is offline", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-ollama",
      model: "gemma3:latest",
      generateJson: async () => {
        throw new Error("Ollama connection failed: connect ECONNREFUSED 127.0.0.1:11434");
      },
      checkHealth: async () => ({ available: false, model: "gemma3:latest", error: "Connection refused" }),
    };

    setMockLlmProvider(mockProvider);

    const formData = new FormData();
    const pdfBuf = createValidPdfBuffer("Tender text for testing offline model error handling");
    formData.append("file", createUploadFile(pdfBuf, "tender.pdf", "application/pdf"));

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.error).toContain("unavailable");
  });

  it("returns 422 Unprocessable Content for scanned/image-only PDFs without calling LLM", async () => {
    let llmCalled = false;
    const mockProvider: LlmProvider = {
      name: "mock-ollama",
      model: "gemma3:latest",
      generateJson: async () => {
        llmCalled = true;
        return "{}";
      },
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const formData = new FormData();
    const scannedBuf = createScannedPdfBuffer();
    formData.append("file", createUploadFile(scannedBuf, "scanned_blueprint.pdf", "application/pdf"));

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.extractionStatus).toBe("scanned_ocr_required");
    expect(body.error).toContain("OCR (Optical Character Recognition) is not yet supported");
    expect(llmCalled).toBe(false);
  }, 15000);

  it("skips empty chunks and reports accurate coverage for a 157-page document with 15 processed pages", async () => {
    let llmCalls = 0;
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async (_messages) => {
        llmCalls++;
        return JSON.stringify({
          metadata: {
            title: "157-Page Government Tender",
            reference: "PWD/2026/157",
            authority: "Public Works Department",
            procurementSource: "GeM",
            estimatedValue: "INR 100 Cr",
            emdAmount: "INR 2 Cr",
            tenderFee: null,
            deadline: null,
            importantDates: [],
          },
          requirements:
            llmCalls === 1
              ? [
                  {
                    title: "Annual Turnover Requirement",
                    category: "financial",
                    mandatory: true,
                    normalizedCondition: "Turnover >= INR 50 Cr",
                    pageNumber: 2,
                    clauseNumber: "Clause 4.1",
                    excerpt: "Average turnover >= INR 50 Cr",
                    rationale: "Financial capacity",
                    requiresHumanReview: false,
                  },
                ]
              : [],
          warnings: [],
        });
      },
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    // Build 157 simulated pages: first 15 have OCR text, remaining 142 are empty / unprocessed
    const pages: ExtractedPage[] = [];
    for (let p = 1; p <= 157; p++) {
      if (p <= 15) {
        pages.push({
          pageNumber: p,
          text: `Page ${p} scanned text: Average turnover >= INR 50 Cr required for qualification.`,
          characterCount: 80,
          method: "ocr",
          confidence: 88,
          ocrStatus: "success",
          requiresHumanReview: false,
        });
      } else {
        pages.push({
          pageNumber: p,
          text: "",
          characterCount: 0,
          method: "ocr",
          confidence: null,
          ocrStatus: "unprocessed",
          ocrWarning: "Exceeded OCR page limit",
          requiresHumanReview: true,
        });
      }
    }

    const unprocessedPages = Array.from({ length: 142 }, (_, i) => i + 16);

    const result = await analyzeTenderPages(pages, "Tendernotice_1.pdf", "ext-157", {
      totalPageCount: 157,
      unprocessedPages,
      extractionStatus: "partial_ocr",
      warnings: ["Only the first 15 pages were processed by OCR."],
    });

    // 15 usable pages in dynamic chunks of 2 = Math.ceil(15 / 2) = 8 LLM calls
    expect(llmCalls).toBe(8);

    // Truthful coverage reporting
    expect(result.pageCount).toBe(157);
    expect(result.analyzedPageCount).toBe(15);
    expect(result.unprocessedPages).toHaveLength(142);
    expect(result.unprocessedPages![0]).toBe(16);
    expect(result.unprocessedPages![141]).toBe(157);
    expect(result.extractionStatus).toBe("partial_ocr");
    expect(result.ocrStatus).toBe("partial");
    expect(result.ocrConfidenceAvg).toBe(88);

    // Warning clearly alerts about partial analysis
    expect(result.warnings.some((w) => w.includes("partially analyzed: 15 of 157 pages"))).toBe(true);

    // Requirement details remain preserved
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]!.source.pageNumber).toBe(2);
  });

  it("propagates low OCR confidence to requirements and rationale", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () =>
        JSON.stringify({
          metadata: {
            title: "Tender with noisy scan",
            reference: null,
            authority: null,
            procurementSource: null,
            estimatedValue: null,
            emdAmount: null,
            tenderFee: null,
            deadline: null,
            importantDates: [],
          },
          requirements: [
            {
              title: "Experience Certificate",
              category: "experience",
              mandatory: true,
              normalizedCondition: "3 years experience",
              pageNumber: 1,
              clauseNumber: null,
              excerpt: "Bidder must have 3 years experience in civil works",
              rationale: "Past performance criteria",
              requiresHumanReview: false, // Model said false, but page confidence was only 32%
            },
          ],
          warnings: [],
        }),
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: "Bidder must have 3 years experience in civil works. Notice issued by state authority.",
        characterCount: 85,
        method: "ocr",
        confidence: 32,
        ocrStatus: "low_confidence",
        requiresHumanReview: true,
      },
    ];

    const result = await analyzeTenderPages(pages, "noisy_scan.pdf", "ext-noisy", {
      totalPageCount: 1,
      extractionStatus: "success",
    });

    expect(result.lowConfidencePages).toEqual([1]);
    expect(result.requirements).toHaveLength(1);

    const req = result.requirements[0]!;
    // Must be forced to true because source page confidence is below 40%
    expect(req.requiresHumanReview).toBe(true);
    expect(req.rationale).toContain("Source page 1 was extracted via OCR with low confidence (32% confidence)");
  });

  it("rejects analysis when document has no usable text across all pages", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () => "{}",
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const emptyPages: ExtractedPage[] = [
      { pageNumber: 1, text: "", characterCount: 0, method: "ocr", ocrStatus: "unprocessed" },
      { pageNumber: 2, text: "   ", characterCount: 0, method: "ocr", ocrStatus: "unprocessed" },
    ];

    await expect(
      analyzeTenderPages(emptyPages, "empty.pdf", "ext-empty", {
        totalPageCount: 2,
        unprocessedPages: [1, 2],
        extractionStatus: "partial_ocr",
      }),
    ).rejects.toThrow("No usable text available in document pages to perform LLM analysis.");
  });

  it("POST /api/tenders/analyze accepts existing extraction result via application/json and analyzes without re-uploading", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () =>
        JSON.stringify({
          metadata: {
            title: "Pre-extracted Tender Analysis",
            reference: "REF-PRE-01",
            authority: "Central Authority",
            procurementSource: "GeM",
            estimatedValue: "INR 10 Cr",
            emdAmount: null,
            tenderFee: null,
            deadline: null,
            importantDates: [],
          },
          requirements: [
            {
              title: "Pre-extracted Financial Clause",
              category: "financial",
              mandatory: true,
              normalizedCondition: "Turnover >= INR 10 Cr",
              pageNumber: 1,
              clauseNumber: "Clause 1.1",
              excerpt: "Turnover must exceed INR 10 Cr",
              rationale: "Financial solvency",
              requiresHumanReview: false,
            },
          ],
          warnings: [],
        }),
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const jsonPayload = {
      extractionId: "ext-pre-extracted-99",
      filename: "pre_extracted_tender.pdf",
      pageCount: 157,
      extractionStatus: "partial_ocr",
      unprocessedPages: [16, 17, 18],
      pages: [
        {
          pageNumber: 1,
          text: "Notice: Turnover must exceed INR 10 Cr for tender qualification.",
          characterCount: 65,
          method: "ocr",
          confidence: 90,
          ocrStatus: "success",
          requiresHumanReview: false,
        },
      ],
      warnings: ["Only 1 page was processed by OCR."],
    };

    const req = {
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => jsonPayload,
    } as unknown as Request;

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.extractionId).toBe("ext-pre-extracted-99");
    expect(body.filename).toBe("pre_extracted_tender.pdf");
    expect(body.pageCount).toBe(157);
    expect(body.analyzedPageCount).toBe(1);
    // Truthful coverage accounting accounts for all remaining 156 pages (2..157)
    expect(body.unprocessedPages).toBeDefined();
    expect(body.unprocessedPages).toHaveLength(156);
    expect(body.unprocessedPages).toContain(2);
    expect(body.unprocessedPages).toContain(16);
    expect(body.unprocessedPages).toContain(157);
    expect(body.analyzedPageCount + body.unprocessedPages.length).toBe(body.pageCount);
    expect(body.extractionStatus).toBe("partial_ocr");
    expect(body.requirements).toHaveLength(1);
    expect(body.requirements[0].source.pageNumber).toBe(1);
    expect(body.requirements[0].source.excerpt).toContain("INR 10 Cr");
  });

  it("propagates low OCR confidence specifically from page 14 (confidence 30) to requirement review flag and verification note", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () =>
        JSON.stringify({
          metadata: {
            title: "Tender Notice with Scanned Appendix",
            reference: "NIT/2026/01",
            authority: "Municipal Corporation",
            procurementSource: "GeM",
            estimatedValue: null,
            emdAmount: null,
            tenderFee: null,
            deadline: null,
            importantDates: [],
          },
          requirements: [
            {
              title: "Interim Advance Bill Condition",
              category: "financial",
              mandatory: true,
              normalizedCondition: "Interim advance bill submission terms",
              pageNumber: 14,
              clauseNumber: "Clause 14.2",
              excerpt: "Vernacular circular text on interim advance bills",
              rationale: "Payment milestone requirement",
              requiresHumanReview: false, // Model claimed false, but page 14 OCR confidence is 30%
            },
          ],
          warnings: [],
        }),
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const pages: ExtractedPage[] = [
      {
        pageNumber: 14,
        text: "Vernacular circular text on interim advance bills and running account settlements.",
        characterCount: 82,
        method: "ocr",
        confidence: 30,
        ocrStatus: "low_confidence",
        requiresHumanReview: true,
      },
    ];

    const result = await analyzeTenderPages(pages, "tender_scan.pdf", "ext-p14", {
      totalPageCount: 14,
      extractionStatus: "partial_ocr",
    });

    // Check lowConfidencePages metadata
    expect(result.lowConfidencePages).toContain(14);

    // Explicitly assert requirement-level propagation
    expect(result.requirements).toHaveLength(1);
    const req = result.requirements[0]!;
    expect(req.source.pageNumber).toBe(14);
    expect(req.requiresHumanReview).toBe(true);
    expect(req.rationale).toContain(
      "[Requires verification: Source page 14 was extracted via OCR with low confidence (30% confidence).]",
    );
  });

  it("reclassifies Performance Guarantee as financial and prevents erroneous EMD categorization", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () =>
        JSON.stringify({
          metadata: {
            title: "MCD Works Tender",
            reference: "NIT-2026-MCD",
            authority: "Municipal Corporation of Delhi",
            procurementSource: "MCD",
            estimatedValue: null,
            emdAmount: null,
            tenderFee: null,
            deadline: null,
            importantDates: [],
          },
          requirements: [
            {
              title: "Earnest Money Deposit (EMD) / Performance Guarantee",
              category: "emd", // Erroneously categorized as EMD by LLM
              mandatory: true,
              normalizedCondition: "5 % of the Estimated cost put to tender (ECPT) or contract amount whichever is higher",
              pageNumber: 2,
              clauseNumber: "Serial Number 2",
              excerpt: "PG shall be 5 % of the Estimated cost put to tender (ECPT) or contract amount whichever is higher.",
              rationale: "Required for bid security.",
              requiresHumanReview: false,
            },
            {
              title: "Earnest Money Deposit",
              category: "emd", // Genuinely an EMD clause
              mandatory: true,
              normalizedCondition: "Bidder must submit EMD of INR 10 Lakhs",
              pageNumber: 2,
              clauseNumber: "Serial Number 1",
              excerpt: "Bidder must submit EMD of INR 10 Lakhs with technical bid.",
              rationale: "Pre-bid earnest money deposit.",
              requiresHumanReview: false,
            },
          ],
          warnings: [],
        }),
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const pages: ExtractedPage[] = [
      {
        pageNumber: 2,
        text: "Serial Number 1 : Bidder must submit EMD of INR 10 Lakhs with technical bid. Serial Number 2 : PG shall be 5 % of the Estimated cost put to tender (ECPT) or contract amount whichever is higher.",
        characterCount: 185,
        method: "ocr",
        confidence: 92,
        ocrStatus: "success",
        requiresHumanReview: false,
      },
    ];

    const result = await analyzeTenderPages(pages, "tender.pdf", "ext-pg", {
      totalPageCount: 2,
      extractionStatus: "success",
    });

    expect(result.requirements).toHaveLength(2);

    // Requirement 1: Performance Guarantee must be reclassified to financial, and hallucinated EMD stripped from title
    const pgReq = result.requirements[0]!;
    expect(pgReq.category).toBe("financial");
    expect(pgReq.title).not.toMatch(/EMD|Earnest Money/i);
    expect(pgReq.title).toBe("Performance Guarantee");
    expect(pgReq.source.excerpt).toContain("PG shall be 5 %");

    // Requirement 2: True EMD clause must remain categorized as emd
    const emdReq = result.requirements[1]!;
    expect(emdReq.category).toBe("emd");
    expect(emdReq.title).toBe("Earnest Money Deposit");
    expect(emdReq.source.excerpt).toContain("EMD of INR 10 Lakhs");
  });

  it("flags requirement for human review when quoted excerpt cannot be verified in page text", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () =>
        JSON.stringify({
          metadata: {
            title: "Road Construction Tender",
            reference: null,
            authority: null,
            procurementSource: null,
            estimatedValue: null,
            emdAmount: null,
            tenderFee: null,
            deadline: null,
            importantDates: [],
          },
          requirements: [
            {
              title: "Valid Turnover Requirement",
              category: "financial",
              mandatory: true,
              normalizedCondition: "Turnover >= 25 Cr",
              pageNumber: 1,
              clauseNumber: "Clause 3.1",
              excerpt: "Average annual financial turnover during the last 3 years should be at least INR 25 Crores.",
              rationale: "Financial solvency",
              requiresHumanReview: false,
            },
            {
              title: "Hallucinated Experience Requirement",
              category: "experience",
              mandatory: true,
              normalizedCondition: "Completed 5 bridge projects",
              pageNumber: 1,
              clauseNumber: "Clause 3.2",
              excerpt: "Contractor must have completed 5 bridge projects of 100 meters span each.",
              rationale: "Technical capability",
              requiresHumanReview: false,
            },
          ],
          warnings: [],
        }),
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: "Notice Inviting Tender. Average annual financial turnover during the last 3 years should be at least INR 25 Crores. No other qualifications specified.",
        characterCount: 147,
        method: "ocr",
        confidence: 88,
        ocrStatus: "success",
        requiresHumanReview: false,
      },
    ];

    const result = await analyzeTenderPages(pages, "road_tender.pdf", "ext-fidelity", {
      totalPageCount: 1,
      extractionStatus: "success",
    });

    expect(result.requirements).toHaveLength(2);

    // Requirement 1: Verbatim excerpt exists in page 1 text -> verified
    const validReq = result.requirements[0]!;
    expect(validReq.requiresHumanReview).toBe(false);
    expect(validReq.rationale).not.toContain("Excerpt could not be verified");

    // Requirement 2: Hallucinated excerpt does NOT exist in page 1 text -> flagged for review
    const hallucinatedReq = result.requirements[1]!;
    expect(hallucinatedReq.requiresHumanReview).toBe(true);
    expect(hallucinatedReq.rationale).toContain(
      "[Requires verification: Excerpt could not be verified verbatim against page 1 text",
    );
  });

  it("strictly accounts for all pages in coverage metrics without silently dropping any pages", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () =>
        JSON.stringify({
          metadata: {
            title: "Coverage Accounting Verification Tender",
            reference: null,
            authority: null,
            procurementSource: null,
            estimatedValue: null,
            emdAmount: null,
            tenderFee: null,
            deadline: null,
            importantDates: [],
          },
          requirements: [
            {
              title: "Clause on Page 2",
              category: "financial",
              mandatory: true,
              normalizedCondition: "Condition on page 2",
              pageNumber: 2,
              clauseNumber: "Clause 2",
              excerpt: "Text on page 2",
              rationale: "Reason",
              requiresHumanReview: false,
            },
            {
              title: "Clause on Page 14",
              category: "technical",
              mandatory: true,
              normalizedCondition: "Condition on page 14",
              pageNumber: 14,
              clauseNumber: "Clause 14",
              excerpt: "Text on page 14",
              rationale: "Reason",
              requiresHumanReview: false,
            },
          ],
          warnings: [],
        }),
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    // Scenario matching the audit query:
    // Total pages = 20
    // Pages with usable text passed: page 2 and page 14 (2 pages)
    // Page with empty text: page 5 (1 page extracted but not sent to LLM)
    // Pages never extracted: pages 1, 3, 4, 6..13, 15..20 (17 pages)
    const pages: ExtractedPage[] = [
      {
        pageNumber: 2,
        text: "Valid text on page 2 for tender requirements.",
        characterCount: 46,
        method: "ocr",
        confidence: 90,
        ocrStatus: "success",
        requiresHumanReview: false,
      },
      {
        pageNumber: 5,
        text: "   ", // Extracted but empty / blank -> not sent to LLM
        characterCount: 0,
        method: "ocr",
        confidence: 0,
        ocrStatus: "failed",
        requiresHumanReview: true,
      },
      {
        pageNumber: 14,
        text: "Valid text on page 14 for technical requirements.",
        characterCount: 49,
        method: "ocr",
        confidence: 85,
        ocrStatus: "success",
        requiresHumanReview: false,
      },
    ];

    const result = await analyzeTenderPages(pages, "coverage_test.pdf", "ext-cov", {
      totalPageCount: 20,
      extractionStatus: "partial_ocr",
    });

    expect(result.pageCount).toBe(20);
    expect(result.analyzedPageCount).toBe(2); // Only pages 2 and 14 had usable text sent to LLM

    // Unprocessed pages must include:
    // - page 5 (extracted but unusable text)
    // - pages 1, 3, 4, 6..13, 15..20 (never extracted)
    // Total unprocessed: 1 + 17 = 18 pages
    expect(result.unprocessedPages).toBeDefined();
    expect(result.unprocessedPages).toHaveLength(18);
    expect(result.unprocessedPages).toContain(5); // Extracted but empty
    expect(result.unprocessedPages).toContain(1); // Never extracted
    expect(result.unprocessedPages).toContain(20); // Never extracted
    expect(result.unprocessedPages).not.toContain(2); // Analyzed
    expect(result.unprocessedPages).not.toContain(14); // Analyzed

    // Mathematical invariant: every page is accounted for
    expect(result.analyzedPageCount + result.unprocessedPages!.length).toBe(result.pageCount);
  });

  it("corrects page citation when excerpt matches uniquely on another processed page", async () => {
    let calls = 0;
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () => {
        calls++;
        return JSON.stringify({
          metadata: { title: null, reference: null, authority: null, procurementSource: null, estimatedValue: null, emdAmount: null, tenderFee: null, deadline: null, importantDates: [] },
          requirements: calls === 1 ? [
            {
              title: "Defect Liability Condition",
              category: "technical",
              mandatory: true,
              normalizedCondition: "Defect liability 12 months from final bill",
              pageNumber: 1, // Model erroneously reported page 1
              clauseNumber: "Clause 1.14",
              excerpt: "अंतिम बिल के भुगतान की तारीख से 12 (Twelve) महीने", // Excerpt actually lives uniquely on page 3
              rationale: "Defect liability period",
              requiresHumanReview: false,
            },
          ] : [],
          warnings: [],
        });
      },
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: "Notice Inviting e-Tender for Electrical Maintenance Works.",
        characterCount: 58,
        method: "native",
        ocrStatus: "not_needed",
      },
      {
        pageNumber: 2,
        text: "Performance Guarantee shall be 5% of tendered value.",
        characterCount: 52,
        method: "native",
        ocrStatus: "not_needed",
      },
      {
        pageNumber: 3,
        text: "Clause 1.14: दोष दायित्व अवधि अंतिम बिल के भुगतान की तारीख से 12 (Twelve) महीने होगी।",
        characterCount: 86,
        method: "native",
        ocrStatus: "not_needed",
      },
    ];

    const result = await analyzeTenderPages(pages, "tender.pdf", "ext-rep", { totalPageCount: 3 });

    expect(result.requirements).toHaveLength(1);
    const req = result.requirements[0]!;

    // Citation must be repaired from 1 to 3
    expect(req.source.pageNumber).toBe(3);
    expect(req.rationale).toContain("[Citation repaired: Reported page 1 corrected to page 3 based on verified excerpt match.]");
    expect(req.requiresHumanReview).toBe(false);
  });

  it("flags ambiguous matches for human review when excerpt appears on multiple pages", async () => {
    let calls = 0;
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () => {
        calls++;
        return JSON.stringify({
          metadata: { title: null, reference: null, authority: null, procurementSource: null, estimatedValue: null, emdAmount: null, tenderFee: null, deadline: null, importantDates: [] },
          requirements: calls === 1 ? [
            {
              title: "Government Entity Reference",
              category: "registration",
              mandatory: true,
              normalizedCondition: "Heavy Water Board Facility registration",
              pageNumber: 3, // Model reported page 3 (where this excerpt is NOT present)
              clauseNumber: "Header",
              excerpt: "Government of India Department of Atomic Energy", // Appears on BOTH Page 1 and Page 2
              rationale: "Jurisdictional authority",
              requiresHumanReview: false,
            },
          ] : [],
          warnings: [],
        });
      },
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: "Government of India Department of Atomic Energy Tender Notice Page 1.",
        characterCount: 69,
        method: "native",
        ocrStatus: "not_needed",
      },
      {
        pageNumber: 2,
        text: "Government of India Department of Atomic Energy Instructions to Bidders Page 2.",
        characterCount: 79,
        method: "native",
        ocrStatus: "not_needed",
      },
      {
        pageNumber: 3,
        text: "Technical Bid submission criteria and specifications.",
        characterCount: 53,
        method: "native",
        ocrStatus: "not_needed",
      },
    ];

    const result = await analyzeTenderPages(pages, "tender.pdf", "ext-ambig", { totalPageCount: 3 });

    expect(result.requirements).toHaveLength(1);
    const req = result.requirements[0]!;

    // Original reported page must be preserved when ambiguous
    expect(req.source.pageNumber).toBe(3);
    expect(req.requiresHumanReview).toBe(true);
    expect(req.rationale).toContain(
      "[Requires verification: Excerpt was ambiguously found on multiple pages (1, 2); unable to deterministically verify cited page.]",
    );
  });

  it("flags requirement for human review when excerpt has zero matches across all processed pages", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () =>
        JSON.stringify({
          metadata: { title: null, reference: null, authority: null, procurementSource: null, estimatedValue: null, emdAmount: null, tenderFee: null, deadline: null, importantDates: [] },
          requirements: [
            {
              title: "Hallucinated ISO Requirement",
              category: "certification",
              mandatory: true,
              normalizedCondition: "ISO 9001:2015 certification mandatory",
              pageNumber: 1,
              clauseNumber: "Clause 9.9",
              excerpt: "Contractor must hold ISO 9001:2015 and ISO 14001:2015 certifications",
              rationale: "Quality management requirement",
              requiresHumanReview: false,
            },
          ],
          warnings: [],
        }),
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: "General maintenance work in residential colony.",
        characterCount: 47,
        method: "native",
        ocrStatus: "not_needed",
      },
    ];

    const result = await analyzeTenderPages(pages, "tender.pdf", "ext-zero", { totalPageCount: 1 });

    expect(result.requirements).toHaveLength(1);
    const req = result.requirements[0]!;

    expect(req.source.pageNumber).toBe(1);
    expect(req.requiresHumanReview).toBe(true);
    expect(req.rationale).toContain(
      "[Requires verification: Excerpt could not be verified verbatim against page 1 text or any other processed page.]",
    );
  });

  it("enforces OCR per-page timeout bounds and truthfully checks language data support", () => {
    expect(MIN_PAGE_TIMEOUT_MS).toBe(3_000);
    expect(HARD_MAX_PAGE_TIMEOUT_MS).toBe(45_000);
    expect(DEFAULT_PER_PAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_PAGE_TIMEOUT_MS);
    expect(DEFAULT_PER_PAGE_TIMEOUT_MS).toBeLessThanOrEqual(HARD_MAX_PAGE_TIMEOUT_MS);

    // English language data is bundled
    expect(isLanguageSupported("eng")).toBe(true);

    // Hindi language data is NOT bundled in current tessdata directory
    expect(isLanguageSupported("hin")).toBe(false);
  });

  it("records chunk profiling metrics for each processed chunk", async () => {
    const mockProvider: LlmProvider = {
      name: "mock-gemma",
      model: "gemma3:latest",
      generateJson: async () =>
        JSON.stringify({
          metadata: { title: null, reference: null, authority: null, procurementSource: null, estimatedValue: null, emdAmount: null, tenderFee: null, deadline: null, importantDates: [] },
          requirements: [
            {
              title: "Experience Requirement",
              category: "experience",
              mandatory: true,
              normalizedCondition: "Turnover condition",
              pageNumber: 1,
              clauseNumber: "Clause 1",
              excerpt: "Experience in similar works",
              rationale: "Experience",
              requiresHumanReview: false,
            },
          ],
          warnings: [],
        }),
      checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
    };

    setMockLlmProvider(mockProvider);

    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: "Experience in similar works for past 3 years.",
        characterCount: 45,
        method: "native",
        ocrStatus: "not_needed",
      },
      {
        pageNumber: 2,
        text: "Annual turnover shall be minimum 50% of estimated cost.",
        characterCount: 56,
        method: "native",
        ocrStatus: "not_needed",
      },
    ];

    const result = await analyzeTenderPages(pages, "tender.pdf", "ext-prof", { totalPageCount: 2 });

    expect(result.profiling).toBeDefined();
    expect(result.profiling).toHaveLength(1);
    const prof = result.profiling![0]!;
    expect(prof.chunkIndex).toBe(1);
    expect(prof.pageNumbers).toEqual([1, 2]);
    expect(prof.characterCount).toBe(101);
    expect(prof.durationMs).toBeGreaterThanOrEqual(0);
    expect(prof.requirementsCount).toBe(1);
    expect(prof.status).toBe("success");
  });

  describe("Document Classification and Tender Metadata Extraction (157-Page Real-World PDF Regression)", () => {
    it("correctly identifies contractual duration and rejects it as bid_submission_deadline", () => {
      const contractualText = "minimum period of six month beyond the date of completion of all contractual obligations as per GCC";
      expect(isContractualDuration(contractualText)).toBe(true);
      expect(isValidBidSubmissionDeadline(contractualText)).toBe(false);

      expect(isContractualDuration("defect liability period of 12 months")).toBe(true);
      expect(isValidBidSubmissionDeadline("defect liability period of 12 months")).toBe(false);

      expect(isContractualDuration("Performance guarantee validity shall be 60 days beyond completion")).toBe(true);
      expect(isValidBidSubmissionDeadline("Performance guarantee validity shall be 60 days beyond completion")).toBe(false);

      expect(isContractualDuration("25.11.2026 at 15:00 Hrs")).toBe(false);
      expect(isValidBidSubmissionDeadline("25.11.2026 at 15:00 Hrs")).toBe(true);

      expect(isContractualDuration("Due date: 2026-10-30 18:00")).toBe(false);
      expect(isValidBidSubmissionDeadline("Due date: 2026-10-30 18:00")).toBe(true);
    });

    it("correctly classifies policy circular, separates contractual duration, and avoids false PROCEED recommendation", async () => {
      // Mimics real 157-page PDF characteristics:
      // Title: "Circular No. Addl. Comm.(Engg.)/MCD/2026/D-88 dated 18.03.2026 — Clarification- Para 5.2 of CPWD Works Manual 2024"
      // Contains contractual duration rather than bid submission deadline
      const mockProvider: LlmProvider = {
        name: "mock-gemma",
        model: "gemma3:latest",
        generateJson: async () =>
          JSON.stringify({
            metadata: {
              documentType: "circular_or_policy",
              title: "Circular No. Addl. Comm.(Engg.)/MCD/2026/D-88 dated 18.03.2026 — Clarification- Para 5.2 of CPWD Works Manual 2024",
              reference: "MCD/2026/D-88",
              authority: "Addl. Commissioner (Engineering)",
              procurementSource: "MCD Engineering Department",
              estimatedValue: null,
              emdAmount: null,
              tenderFee: null,
              deadline: "minimum period of six month beyond the date of completion of all contractual obligations as per GCC",
              importantDates: [],
            },
            requirements: [
              {
                title: "Performance Guarantee Validity",
                category: "financial",
                mandatory: true,
                normalizedCondition: "Performance Guarantee valid for six months beyond completion of all contractual obligations",
                pageNumber: 1,
                clauseNumber: "Para 5.2",
                excerpt: "minimum period of six month beyond the date of completion of all contractual obligations as per GCC",
                rationale: "Contractual guarantee validity period",
                requiresHumanReview: false,
              },
            ],
            warnings: [],
          }),
        checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
      };

      setMockLlmProvider(mockProvider);

      const pages: ExtractedPage[] = [
        {
          pageNumber: 1,
          text: "CIRCULAR NO. Addl. Comm.(Engg.)/MCD/2026/D-88 dated 18.03.2026\nMUNICIPAL CORPORATION OF DELHI\nSubject: Clarification- Para 5.2 of CPWD Works Manual 2024.\nPerformance Guarantee shall remain valid for a minimum period of six month beyond the date of completion of all contractual obligations as per GCC.",
          characterCount: 260,
          method: "native",
          ocrStatus: "not_needed",
        },
      ];

      const result = await analyzeTenderPages(pages, "Tendernotice_1.pdf", "ext-circ-157", { totalPageCount: 157 });

      // 1. Explicit document type classification
      expect(result.metadata.documentType).toBe("circular_or_policy");
      expect(result.documentType).toBe("circular_or_policy");

      // 2. Deadline separation: contractual duration must NOT be classified as bid deadline
      expect(result.metadata.bidSubmissionDeadline).toBeNull();
      expect(result.metadata.deadline).toBeNull();

      // 3. Contractual duration is preserved in structured field
      expect(result.contractualDurations).toBeDefined();
      expect(result.contractualDurations!.length).toBeGreaterThan(0);
      expect(result.contractualDurations![0]!.duration).toContain("six month beyond");

      // 4. No tender-specific metadata invented (EMD, estimated value are null)
      expect(result.metadata.emdAmount).toBeNull();
      expect(result.metadata.estimatedValue).toBeNull();

      // 5. Warning generated for circular document
      expect(result.warnings.some((w) => w.toLowerCase().includes("circular") || w.toLowerCase().includes("not an active tender notice"))).toBe(true);

      // 6. Non-tender recommendation: must be INVESTIGATE, never PROCEED
      const decision = decide(result.requirements, { documentType: result.metadata.documentType });
      expect(decision.recommendation).toBe("INVESTIGATE");
      expect(decision.summary).toContain("circular");
    });

    it("correctly classifies genuine tender notice (NIT) with valid submission deadline", async () => {
      const mockProvider: LlmProvider = {
        name: "mock-gemma",
        model: "gemma3:latest",
        generateJson: async () =>
          JSON.stringify({
            metadata: {
              documentType: "tender_notice",
              title: "Notice Inviting e-Tender for Road Resurfacing in Rohini Zone",
              reference: "NIT/MCD/2026/902",
              authority: "Municipal Corporation of Delhi",
              procurementSource: "Delhi e-Procurement Portal",
              estimatedValue: "INR 4.5 Cr",
              emdAmount: "INR 9,00,000",
              tenderFee: "INR 5,000",
              bidSubmissionDeadline: "25.11.2026 at 15:00 Hrs",
              deadline: "25.11.2026 at 15:00 Hrs",
              importantDates: [{ event: "Bid Submission End Date", date: "25.11.2026 at 15:00 Hrs" }],
            },
            requirements: [
              {
                title: "Earnest Money Deposit",
                category: "emd",
                mandatory: true,
                normalizedCondition: "EMD of INR 9 Lakhs required before submission",
                pageNumber: 1,
                clauseNumber: "Clause 3",
                excerpt: "EMD of INR 9,00,000 shall be deposited online.",
                rationale: "Pre-bid earnest money deposit",
                requiresHumanReview: false,
              },
            ],
            warnings: [],
          }),
        checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
      };

      setMockLlmProvider(mockProvider);

      const pages: ExtractedPage[] = [
        {
          pageNumber: 1,
          text: "MUNICIPAL CORPORATION OF DELHI\nNOTICE INVITING E-TENDER No. NIT/MCD/2026/902\nNotice Inviting e-Tender for Road Resurfacing in Rohini Zone.\nEstimated cost: INR 4.5 Cr. EMD of INR 9,00,000 shall be deposited online.\nLast date and time of submission of bids: 25.11.2026 at 15:00 Hrs.",
          characterCount: 280,
          method: "native",
          ocrStatus: "not_needed",
        },
      ];

      const result = await analyzeTenderPages(pages, "genuine-nit.pdf", "ext-nit-1", { totalPageCount: 1 });

      expect(result.metadata.documentType).toBe("tender_notice");
      expect(result.metadata.bidSubmissionDeadline).toBe("25.11.2026 at 15:00 Hrs");
      expect(result.metadata.deadline).toBe("25.11.2026 at 15:00 Hrs");
      expect(result.metadata.emdAmount).toBe("INR 9,00,000");

      const decision = decide(result.requirements, { documentType: result.metadata.documentType });
      expect(decision.recommendation).toBe("INVESTIGATE");
      expect(decision.summary).not.toContain("circular");
    });

    it("detects mixed compilation containing circular, GCC conditions and corrigendum across page ranges", async () => {
      const mockProvider: LlmProvider = {
        name: "mock-gemma",
        model: "gemma3:latest",
        generateJson: async () =>
          JSON.stringify({
            metadata: {
              documentType: "mixed_compilation",
              title: "Compilation of Engineering Department Circulars and Contract Conditions",
              reference: null,
              authority: "Municipal Corporation of Delhi",
              procurementSource: null,
              estimatedValue: null,
              emdAmount: null,
              tenderFee: null,
              deadline: null,
              importantDates: [],
            },
            requirements: [
              {
                title: "Works Manual Clarification",
                category: "other",
                mandatory: "unknown",
                normalizedCondition: "Clarification on Works Manual Para 5.2",
                pageNumber: 1,
                clauseNumber: "Para 5.2",
                excerpt: "Circular regarding Works Manual clarifications",
                rationale: "Administrative clarification",
                requiresHumanReview: false,
              },
              {
                title: "General Conditions - Quality Audit",
                category: "technical",
                mandatory: true,
                normalizedCondition: "Mandatory third party quality audit",
                pageNumber: 4,
                clauseNumber: "GCC Clause 18",
                excerpt: "Third party quality audit as per GCC Clause 18",
                rationale: "Quality audit clause",
                requiresHumanReview: false,
              },
              {
                title: "Corrigendum Date Extension",
                category: "deadline",
                mandatory: false,
                normalizedCondition: "Corrigendum extending submission",
                pageNumber: 8,
                clauseNumber: "Corr-1",
                excerpt: "Corrigendum extending date of submission",
                rationale: "Corrigendum amendment",
                requiresHumanReview: false,
              },
            ],
            warnings: [],
          }),
        checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
      };

      setMockLlmProvider(mockProvider);

      const pages: ExtractedPage[] = [
        {
          pageNumber: 1,
          text: "CIRCULAR NO. MCD/ENGG/2026/01\nCircular regarding Works Manual clarifications.",
          characterCount: 75,
          method: "native",
          ocrStatus: "not_needed",
        },
        {
          pageNumber: 2,
          text: "Further guidelines on circular MCD/ENGG/2026/01.",
          characterCount: 50,
          method: "native",
          ocrStatus: "not_needed",
        },
        {
          pageNumber: 4,
          text: "GENERAL CONDITIONS OF CONTRACT FOR WORKS\nThird party quality audit as per GCC Clause 18.",
          characterCount: 95,
          method: "native",
          ocrStatus: "not_needed",
        },
        {
          pageNumber: 8,
          text: "CORRIGENDUM NO. 1 - AMENDMENT TO TENDER CONDITIONS\nCorrigendum extending date of submission.",
          characterCount: 95,
          method: "native",
          ocrStatus: "not_needed",
        },
      ];

      const result = await analyzeTenderPages(pages, "compilation.pdf", "ext-comp-1", { totalPageCount: 8 });

      // 1. Overall document type must be mixed_compilation
      expect(result.metadata.documentType).toBe("mixed_compilation");
      expect(result.metadata.isCompilation).toBe(true);

      // 2. Preserves sections with page ranges
      expect(result.sections).toBeDefined();
      expect(result.sections!.length).toBeGreaterThanOrEqual(3);

      const sec1 = result.sections!.find((s) => s.documentType === "circular_or_policy");
      expect(sec1).toBeDefined();
      expect(sec1!.pageRange[0]).toBe(1);

      const sec2 = result.sections!.find((s) => s.documentType === "contract_conditions");
      expect(sec2).toBeDefined();
      expect(sec2!.pageRange[0]).toBe(4);

      const sec3 = result.sections!.find((s) => s.documentType === "amendment_or_corrigendum");
      expect(sec3).toBeDefined();
      expect(sec3!.pageRange[0]).toBe(8);

      // 3. Requirements preserve section attribution
      expect(result.requirements[0]!.sectionTitle).toBeDefined();
      expect(result.requirements[1]!.sectionTitle).toMatch(/General Conditions/i);

      // 4. Decision handles compilation truthfully
      const decision = decide(result.requirements, { documentType: result.metadata.documentType });
      expect(decision.recommendation).toBe("INVESTIGATE");
      expect(decision.summary).toContain("mixed compilation");
    });

    it("classifies contract conditions manual and extracts contractual duration", async () => {
      const mockProvider: LlmProvider = {
        name: "mock-gemma",
        model: "gemma3:latest",
        generateJson: async () =>
          JSON.stringify({
            metadata: {
              documentType: "contract_conditions",
              title: "CPWD Works Manual 2024 - General Conditions of Contract",
              reference: "CPWD-2024",
              authority: "Central Public Works Department",
              procurementSource: null,
              estimatedValue: null,
              emdAmount: null,
              tenderFee: null,
              deadline: null,
              importantDates: [],
            },
            requirements: [
              {
                title: "Defect Liability Period",
                category: "technical",
                mandatory: true,
                normalizedCondition: "Defect liability period of 12 months",
                pageNumber: 1,
                clauseNumber: "Clause 17",
                excerpt: "Defect liability period shall be 12 months from the date of completion.",
                rationale: "Post-completion defect liability",
                requiresHumanReview: false,
              },
            ],
            warnings: [],
          }),
        checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
      };

      setMockLlmProvider(mockProvider);

      const pages: ExtractedPage[] = [
        {
          pageNumber: 1,
          text: "GENERAL CONDITIONS OF CONTRACT (GCC)\nCPWD Works Manual 2024.\nDefect liability period shall be 12 months from the date of completion.",
          characterCount: 145,
          method: "native",
          ocrStatus: "not_needed",
        },
      ];

      const result = await analyzeTenderPages(pages, "gcc.pdf", "ext-gcc-1", { totalPageCount: 1 });

      expect(result.metadata.documentType).toBe("contract_conditions");
      expect(result.metadata.bidSubmissionDeadline).toBeNull();
      expect(result.warnings.some((w) => w.includes("contract_conditions"))).toBe(true);

      const decision = decide(result.requirements, { documentType: result.metadata.documentType });
      expect(decision.recommendation).toBe("INVESTIGATE");
      expect(decision.summary).toContain("general conditions of contract");
    });

    it("classifies unknown document and flags requirements for human review", async () => {
      const mockProvider: LlmProvider = {
        name: "mock-gemma",
        model: "gemma3:latest",
        generateJson: async () =>
          JSON.stringify({
            metadata: {
              documentType: "unknown",
              title: "Internal Notes on Facility Equipment",
              reference: null,
              authority: null,
              procurementSource: null,
              estimatedValue: null,
              emdAmount: null,
              tenderFee: null,
              deadline: null,
              importantDates: [],
            },
            requirements: [
              {
                title: "Equipment Inspection",
                category: "technical",
                mandatory: "unknown",
                normalizedCondition: "Periodic equipment inspection required",
                pageNumber: 1,
                clauseNumber: null,
                excerpt: "Equipment should be inspected regularly.",
                rationale: "Maintenance guideline",
                requiresHumanReview: false,
              },
            ],
            warnings: [],
          }),
        checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
      };

      setMockLlmProvider(mockProvider);

      const pages: ExtractedPage[] = [
        {
          pageNumber: 1,
          text: "Internal notes discussing office furniture and equipment. Equipment should be inspected regularly.",
          characterCount: 105,
          method: "native",
          ocrStatus: "not_needed",
        },
      ];

      const result = await analyzeTenderPages(pages, "notes.pdf", "ext-unk-1", { totalPageCount: 1 });

      expect(result.metadata.documentType).toBe("unknown");
      expect(result.requirements[0]!.requiresHumanReview).toBe(true);
      expect(result.requirements[0]!.rationale).toContain("Document classification is unknown");

      const decision = decide(result.requirements, { documentType: result.metadata.documentType });
      expect(decision.recommendation).toBe("INVESTIGATE");
      expect(decision.summary).toContain("Document type could not be reliably verified");
    });

    describe("Browser Result Regressions: Section Segmentation, Title-Only Clauses, Document Linking & Counters", () => {
      it("segments multiple consecutive circulars followed by a long contract manual with accurate non-overlapping page ranges", () => {
        const pages: ExtractedPage[] = [
          // Circular 1 (Page 1)
          {
            pageNumber: 1,
            text: "MUNICIPAL CORPORATION OF DELHI\nOFFICE OF THE ADDITIONAL COMMISSIONER (ENGG)\nNo:- Addl. Comm.(Engg)/MCD/2026/D-18 Dated:- 20/04/2026\nCIRCULAR\nSub: Guidelines for disciplinary action against contractors.\nDetailed guidelines for taking action.",
            characterCount: 220,
            method: "native",
            ocrStatus: "not_needed",
          },
          // Circular 2 (Page 2) - adjacent circular with new ref and date
          {
            pageNumber: 2,
            text: "OFFICE OF THE ADDL. COMMISSIONER (ENGINEERING)\nNo: - Addl. Comm(Engg.)/MCD/2026/D-112 Dated: 21-04-2026\nCIRCULAR\nSubject:- Clarification- Para 5.2 of CPWD Works Manual 2024.\nPerformance guarantee instructions.",
            characterCount: 230,
            method: "native",
            ocrStatus: "not_needed",
          },
          // Circular 3 (Pages 3-5: page 3 header, page 4 continuation, page 5 Annexure A)
          {
            pageNumber: 3,
            text: "MUNICIPAL CORPORATION OF DELHI\nOffice of the Addl. Commissioner (Engg.)\nNo. Addl. Comm. (Engg.)/2026/MCD/D-100 Dated: 27/03/2026\nCIRCULAR\nChecking of works through TPQAA / QC Cell.",
            characterCount: 180,
            method: "native",
            ocrStatus: "not_needed",
          },
          {
            pageNumber: 4,
            text: "3. If the TPQAA mentioned above are not willing to carry out the 3rd party quality assurance then the following agencies can be considered.",
            characterCount: 140,
            method: "native",
            ocrStatus: "not_needed",
          },
          {
            pageNumber: 5,
            text: "Annexure 'A' - Third Party Quality Audit Charges\nNo. Addl. Comm. (Engg.)/2026/MCD/D-100\nMandatory quality audit charges table.",
            characterCount: 130,
            method: "native",
            ocrStatus: "not_needed",
          },
          // Order 4 (Page 6)
          {
            pageNumber: 6,
            text: "MUNICIPAL CORPORATION OF DELHI\nOFFICE OF EXECUTIVE ENGINEER (PLG.)-IV\nNo.D/EE(P)-IV/MCD/2025-26/D-01 Dated: 15/07/2025\nORDER\nAdoption of CPWD GCC Clauses 7 & 9 for construction works.",
            characterCount: 190,
            method: "native",
            ocrStatus: "not_needed",
          },
          // Transition into CPWD GCC Manual (Pages 7-157)
          {
            pageNumber: 7,
            text: "Clause 7 Payment on intermediate certificate to be regarded as advances.\nNo payment shall be made for work estimated to cost Rs. Five lac or less till after the whole of the work shall have been completed.",
            characterCount: 220,
            method: "native",
            ocrStatus: "not_needed",
          },
          {
            pageNumber: 8,
            text: "Clause 7 (Hindi translation / bilingual text)\nPrastut karya ke intermediate payment advance ke roop mein maney honge.",
            characterCount: 150,
            method: "native",
            ocrStatus: "not_needed",
          },
          {
            pageNumber: 15,
            text: "Clause 8 Completion certificate and completion plans.\nWithin ten days of the completion of the work the contractor shall give notice of such completion.",
            characterCount: 170,
            method: "native",
            ocrStatus: "not_needed",
          },
        ];

        const classification = classifyDocumentAndSections(pages);

        // 1. Overall classification must be mixed compilation
        expect(classification.overallType).toBe("mixed_compilation");
        expect(classification.isCompilation).toBe(true);

        // 2. Must report exactly 5 grounded non-overlapping sections
        expect(classification.sections.length).toBe(5);

        // Section 1: Circular D-18 on Page 1
        expect(classification.sections[0]!.documentType).toBe("circular_or_policy");
        expect(classification.sections[0]!.pageRange).toEqual([1, 1]);
        expect(classification.sections[0]!.title).toContain("Guidelines for disciplinary action");

        // Section 2: Circular D-112 on Page 2
        expect(classification.sections[1]!.documentType).toBe("circular_or_policy");
        expect(classification.sections[1]!.pageRange).toEqual([2, 2]);
        expect(classification.sections[1]!.title).toContain("Clarification- Para 5.2");

        // Section 3: Circular D-100 on Pages 3-5 (including continuation page 4 and Annexure A on page 5)
        expect(classification.sections[2]!.documentType).toBe("circular_or_policy");
        expect(classification.sections[2]!.pageRange).toEqual([3, 5]);

        // Section 4: Order D-01 on Page 6
        expect(classification.sections[3]!.documentType).toBe("circular_or_policy");
        expect(classification.sections[3]!.pageRange).toEqual([6, 6]);

        // Section 5: Transition into GCC Contract Manual starting at Page 7 through the end of the document (15 or 157)
        expect(classification.sections[4]!.documentType).toBe("contract_conditions");
        expect(classification.sections[4]!.pageRange[0]).toBe(7);
        expect(classification.sections[4]!.pageRange[1]).toBe(15);
        expect(classification.sections[4]!.title).toContain("General Conditions of Contract");

        // Check non-overlapping integrity across all sections
        for (let i = 0; i < classification.sections.length - 1; i++) {
          const cur = classification.sections[i]!;
          const next = classification.sections[i + 1]!;
          expect(cur.pageRange[1]).toBeLessThan(next.pageRange[0]);
          expect(next.pageRange[0]).toBe(cur.pageRange[1] + 1);
        }
      });

      it("rejects title-only clauses from becoming requirements, flags disciplinary policies, and preserves operative clauses when available", async () => {
        const mockProvider: LlmProvider = {
          name: "mock-gemma",
          model: "gemma3:latest",
          generateJson: async () =>
            JSON.stringify({
              metadata: {
                documentType: "circular_or_policy",
                title: "Guidelines for disciplinary action against contractors",
                authority: "MCD",
                reference: "D-18",
              },
              requirements: [
                // Requirement 1: Disciplinary policy with title-only excerpt and no operative obligation
                {
                  title: "Demotion to a lower class",
                  category: "eligibility",
                  mandatory: true,
                  normalizedCondition: "Demotion to a lower class",
                  pageNumber: 1,
                  clauseNumber: "23.1",
                  excerpt: "Demotion to a lower class",
                  rationale: "Contractor penalty",
                  requiresHumanReview: false,
                },
                // Requirement 2: Title-only excerpt where page text contains a full operative clause
                {
                  title: "Suspension of business",
                  category: "other",
                  mandatory: true,
                  normalizedCondition: "Suspension of business for one year",
                  pageNumber: 2,
                  clauseNumber: "23.2",
                  excerpt: "Suspension of business",
                  rationale: "Disciplinary rule",
                  requiresHumanReview: false,
                },
              ],
              warnings: [],
            }),
          checkHealth: async () => ({ available: true, model: "gemma3:latest" }),
        };

        setMockLlmProvider(mockProvider);

        const pages: ExtractedPage[] = [
          // Page 1: only has a table cell header "Demotion to a lower class"
          {
            pageNumber: 1,
            text: "CIRCULAR - Disciplinary Action\nTable 1: Clause | Action\n1 | Demotion to a lower class\nEnd of table.",
            characterCount: 110,
            method: "ocr",
            ocrStatus: "completed",
            confidence: 85,
          },
          // Page 2: has a full operative sentence containing "Suspension of business"
          {
            pageNumber: 2,
            text: "Clause 23.2 provides that suspension of business for one year shall be imposed if the contractor fails to start the work on two consecutive occasions without valid reasons.",
            characterCount: 180,
            method: "ocr",
            ocrStatus: "low_confidence",
            confidence: 35,
          },
        ];

        const result = await analyzeTenderPages(pages, "disciplinary.pdf", "ext-disp-1", { totalPageCount: 2 });

        // Check Requirement 1:
        const req1 = result.requirements[0]!;
        // Must be categorized as "other" (not "eligibility")
        expect(req1.category).toBe("other");
        // Must NOT be mandatory
        expect(req1.mandatory).toBe(false);
        // Must be flagged for human review
        expect(req1.requiresHumanReview).toBe(true);
        // Rationale must explain both disciplinary policy and title-only excerpt verification
        expect(req1.rationale).toContain("Disciplinary policy");
        expect(req1.rationale).toContain("Cited excerpt is only a heading/title and does not substantiate an operative requirement");

        // Check Requirement 2:
        const req2 = result.requirements[1]!;
        // Preserves full operative clause from page text without inventing text
        expect(req2.source.excerpt).toContain("suspension of business for one year shall be imposed");
        // Disciplinary policy is non-mandatory
        expect(req2.mandatory).toBe(false);
        // OCR confidence warning is preserved (confidence was 35%)
        expect(req2.requiresHumanReview).toBe(true);
        expect(req2.rationale).toContain("Source page 2 was extracted via OCR with low confidence (35% confidence)");
        expect(req2.source.pageNumber).toBe(2);
      });

      it("proves that requirements with valid source citations link to the document, while missing/invalid citations do not create false links", () => {
        const doc = {
          id: "as-101-doc",
          filename: "Tendernotice_1.pdf",
        };

        // Case A: Valid citation matching filename
        const validReqMatchingFilename: TenderRequirement = {
          id: "req-1",
          title: "Performance Guarantee",
          category: "financial",
          mandatory: true,
          normalizedCondition: "PG of 5% valid for 6 months beyond completion",
          source: {
            documentId: "Tendernotice_1.pdf",
            pageNumber: 2,
            clauseNumber: "Para 5.2",
            excerpt: "Performance Guarantee shall remain valid for a minimum period of six month beyond completion.",
          },
          status: "UNKNOWN",
          matchedEvidenceIds: [],
          rationale: "Valid clause",
          requiresHumanReview: false,
          review: "pending",
        };

        // Case B: Valid citation matching doc.id directly
        const validReqMatchingDocId: TenderRequirement = {
          id: "req-2",
          title: "Third Party Quality Audit",
          category: "technical",
          mandatory: true,
          normalizedCondition: "TPQAA inspection required",
          source: {
            documentId: "as-101-doc",
            pageNumber: 3,
            clauseNumber: null,
            excerpt: "Checking of works through TPQAA involves site inspection.",
          },
          status: "UNKNOWN",
          matchedEvidenceIds: [],
          rationale: "Valid clause",
          requiresHumanReview: false,
          review: "pending",
        };

        // Case C: Missing page citation (pageNumber is null)
        const invalidReqMissingPage: TenderRequirement = {
          id: "req-3",
          title: "Unverified Clause",
          category: "other",
          mandatory: false,
          normalizedCondition: "Unverified",
          source: {
            documentId: "Tendernotice_1.pdf",
            pageNumber: null,
            excerpt: "Some unverified text without a page citation",
          },
          status: "UNKNOWN",
          matchedEvidenceIds: [],
          rationale: "No page citation",
          requiresHumanReview: true,
          review: "pending",
        };

        // Case D: Empty excerpt (heading/label with no text)
        const invalidReqEmptyExcerpt: TenderRequirement = {
          id: "req-4",
          title: "Empty Excerpt Clause",
          category: "other",
          mandatory: false,
          normalizedCondition: "Empty excerpt",
          source: {
            documentId: "Tendernotice_1.pdf",
            pageNumber: 5,
            excerpt: "",
          },
          status: "UNKNOWN",
          matchedEvidenceIds: [],
          rationale: "Empty excerpt",
          requiresHumanReview: true,
          review: "pending",
        };

        // Case E: Citation belonging to an entirely different document
        const invalidReqDifferentDoc: TenderRequirement = {
          id: "req-5",
          title: "Other Document Clause",
          category: "experience",
          mandatory: true,
          normalizedCondition: "Experience criteria",
          source: {
            documentId: "other_annexure.pdf",
            pageNumber: 1,
            excerpt: "Experience in bridge construction",
          },
          status: "UNKNOWN",
          matchedEvidenceIds: [],
          rationale: "Other document",
          requiresHumanReview: false,
          review: "pending",
        };

        // Assert isRequirementLinkedToDocument correctness
        expect(isRequirementLinkedToDocument(validReqMatchingFilename, doc)).toBe(true);
        expect(isRequirementLinkedToDocument(validReqMatchingDocId, doc)).toBe(true);
        expect(isRequirementLinkedToDocument(invalidReqMissingPage, doc)).toBe(false);
        expect(isRequirementLinkedToDocument(invalidReqEmptyExcerpt, doc)).toBe(false);
        expect(isRequirementLinkedToDocument(invalidReqDifferentDoc, doc)).toBe(false);

        // Test linkRequirementsToDocument mapping
        const allReqs = [
          validReqMatchingFilename,
          validReqMatchingDocId,
          invalidReqMissingPage,
          invalidReqEmptyExcerpt,
          invalidReqDifferentDoc,
        ];

        const linked = linkRequirementsToDocument(allReqs, doc);

        // Only valid requirements link to doc.id
        expect(linked[0]!.source!.documentId).toBe("as-101-doc");
        expect(linked[1]!.source!.documentId).toBe("as-101-doc");
        // Invalid citations have their false documentId link removed
        expect(linked[2]!.source!.documentId).toBeUndefined();
        expect(linked[3]!.source!.documentId).toBeUndefined();
        // Mismatched document is preserved as-is
        expect(linked[4]!.source!.documentId).toBe("other_annexure.pdf");

        // Verify that filtering for document references returns exactly 2, never 5
        const docReferences = linked.filter((r) => isRequirementLinkedToDocument(r, doc));
        expect(docReferences.length).toBe(2);
        expect(docReferences.map((r) => r.id)).toEqual(["req-1", "req-2"]);
      });

      it("verifies status counters and ensures UNKNOWN never counts as MET", () => {
        // Construct 7 extracted requirements where evidence has not yet been matched
        const testRequirements: TenderRequirement[] = Array.from({ length: 7 }, (_, i) => ({
          id: `req-${i + 1}`,
          title: `Requirement ${i + 1}`,
          category: "financial",
          mandatory: true,
          normalizedCondition: `Condition ${i + 1}`,
          status: "UNKNOWN" as const,
          matchedEvidenceIds: [],
          rationale: "Awaiting company evidence comparison",
          requiresHumanReview: i < 3, // 3 need review
          review: "pending" as const,
        }));

        // Compute status counters
        const total = testRequirements.length;
        const metCount = testRequirements.filter((r) => effectiveStatus(r) === "MET").length;
        const unmetCount = testRequirements.filter((r) => effectiveStatus(r) === "UNMET").length;
        const unknownCount = testRequirements.filter((r) => effectiveStatus(r) === "UNKNOWN").length;
        const mandatoryCount = testRequirements.filter((r) => r.mandatory === true).length;
        const reviewCount = testRequirements.filter((r) => r.requiresHumanReview && r.review !== "confirmed").length;

        // Verify mathematical integrity
        expect(total).toBe(7);
        expect(metCount).toBe(0);
        expect(unmetCount).toBe(0);
        expect(unknownCount).toBe(7);
        expect(metCount + unmetCount + unknownCount).toBe(total);

        expect(mandatoryCount).toBe(7);
        expect(reviewCount).toBe(3);

        // Invariant: UNKNOWN must never count as MET
        expect(metCount).not.toBe(unknownCount);
        expect(metCount).toBe(0);
      });
    });
  });
});

