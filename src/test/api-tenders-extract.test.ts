// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Route } from "@/routes/api.tenders.extract";
import {
  validatePdfFile,
  extractTextFromPdf,
  MAX_PDF_SIZE_BYTES,
} from "@/lib/server/pdf";

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

describe("PDF Ingestion & Text Extraction Validation", () => {
  it("rejects missing file with 400", () => {
    const res = validatePdfFile(null, new Uint8Array());
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("No file provided");
    }
  });

  it("rejects empty buffer with 400", () => {
    const file = new File([], "tender.pdf", { type: "application/pdf" });
    const res = validatePdfFile(file, new Uint8Array());
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("empty");
    }
  });

  it("rejects non-PDF extension with 415 Unsupported Media Type", () => {
    const fakeData = new Uint8Array(Buffer.from("Hello"));
    const file = new File([fakeData], "proposal.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const res = validatePdfFile(file, fakeData);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.status).toBe(415);
      expect(res.error).toContain("Only PDF documents");
    }
  });

  it("rejects renamed fake PDF files missing %PDF- header with 400", () => {
    const fakeData = new Uint8Array(Buffer.from("This is just plain text, not a PDF."));
    const file = new File([fakeData], "fake.pdf", { type: "application/pdf" });
    const res = validatePdfFile(file, fakeData);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.status).toBe(400);
      expect(res.error).toContain("header signature");
    }
  });

  it("rejects files exceeding maximum limit with 413 Payload Too Large", () => {
    const oversizedBuffer = new Uint8Array(MAX_PDF_SIZE_BYTES + 1024);
    // Add valid magic header so only size fails
    oversizedBuffer.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    const file = new File([oversizedBuffer], "huge.pdf", { type: "application/pdf" });

    const res = validatePdfFile(file, oversizedBuffer);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.status).toBe(413);
      expect(res.error).toContain("exceeds maximum allowed size");
    }
  });

  it("extracts text correctly page-by-page from a valid PDF", async () => {
    const tenderNoticeText = "Tender No: PWD-KA-2026-884 for Highway Construction";
    const pdfBuf = createValidPdfBuffer(tenderNoticeText);

    const result = await extractTextFromPdf(pdfBuf, "tender_notice.pdf");
    expect(result.extractionStatus).toBe("success");
    expect(result.pageCount).toBe(1);
    expect(result.pages[0]?.text).toContain("PWD-KA-2026-884");
    expect(result.totalCharacters).toBeGreaterThan(20);
    expect(result.extractionId).toMatch(/^ext-/);
  });

  it("explicitly detects scanned/image-only PDFs and flags OCR required", async () => {
    const scannedBuf = createScannedPdfBuffer();

    const result = await extractTextFromPdf(scannedBuf, "scanned_doc.pdf");
    expect(result.extractionStatus).toBe("scanned_ocr_required");
    expect(result.error).toContain("OCR (Optical Character Recognition) is not yet supported");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.totalCharacters).toBe(0);
  }, 15000);
});

describe("POST /api/tenders/extract Endpoint", () => {
  const handler = (Route.options.server?.handlers as any)?.POST;

  it("returns 400 when body is not valid multipart/form-data", async () => {
    const req = new Request("http://localhost/api/tenders/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "none" }),
    });

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(400);
  });

  it("returns 400 when 'file' field is missing from form-data", async () => {
    const formData = new FormData();
    formData.append("other_field", "value");

    const req = new Request("http://localhost/api/tenders/extract", {
      method: "POST",
      body: formData,
    });

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No file provided");
  });

function createUploadFile(buf: Uint8Array, name: string, type: string): File {
  const f = new File([buf.buffer as ArrayBuffer], name, { type });
  (f as any)._buffer = buf;
  return f;
}

  it("returns 415 when uploaded file is not a PDF", async () => {
    const formData = new FormData();
    const data = new Uint8Array(Buffer.from("dummy image bytes"));
    formData.append("file", createUploadFile(data, "document.png", "image/png"));

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain("Only PDF documents");
  });

  it("returns 400 when uploaded file is a fake/corrupted PDF", async () => {
    const formData = new FormData();
    const data = new Uint8Array(Buffer.from("Not a real PDF"));
    formData.append("file", createUploadFile(data, "corrupted.pdf", "application/pdf"));

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("header signature");
  });

  it("returns 422 when uploaded PDF is scanned/image-only without text", async () => {
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
  });

  it("returns 200 with structured pages and extraction ID for valid PDF", async () => {
    const formData = new FormData();
    const tenderPdf = createValidPdfBuffer("Bid Document for Construction of Flyover at Junction 4");
    formData.append("file", createUploadFile(tenderPdf, "nit_flyover.pdf", "application/pdf"));

    const req = {
      formData: async () => formData,
    } as unknown as Request;

    const res = await handler!({ request: req } as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.extractionStatus).toBe("success");
    expect(body.filename).toBe("nit_flyover.pdf");
    expect(body.pageCount).toBe(1);
    expect(body.totalCharacters).toBeGreaterThan(20);
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0].pageNumber).toBe(1);
    expect(body.pages[0].text).toContain("Flyover at Junction 4");
    expect(body.extractionId).toMatch(/^ext-/);
  });
});
