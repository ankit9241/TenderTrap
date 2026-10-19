import { extractText } from "unpdf";
import { sanitizeError } from "./db";
import { DEFAULT_MAX_OCR_PAGES, processPagesWithOcr, type OcrProcessingOptions } from "./ocr";

/**
 * Maximum allowed PDF file size: 25 MB default (configurable via MAX_PDF_SIZE_MB).
 */
const configuredMaxMb = process.env["MAX_PDF_SIZE_MB"]
  ? Number(process.env["MAX_PDF_SIZE_MB"])
  : 25;
export const MAX_PDF_SIZE_BYTES =
  (!isNaN(configuredMaxMb) && configuredMaxMb > 0 ? configuredMaxMb : 25) * 1024 * 1024;

/**
 * Maximum extracted character limit across all pages to protect server memory.
 * 2,000,000 characters is approximately 300,000 words (~500+ pages of dense text).
 */
export const MAX_EXTRACTED_CHARS = 2_000_000;

/**
 * Threshold of characters across the document below which a PDF is considered
 * image-only or scanned.
 */
export const MIN_TEXT_CHARS_FOR_OCR_CHECK = 20;

/**
 * Minimum characters on a single page to be considered sufficient without OCR.
 */
export const MIN_PAGE_TEXT_CHARS = 20;

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  characterCount: number;
  method: "native" | "ocr";
  confidence?: number | null;
  ocrWarning?: string;
  ocrStatus?: "success" | "low_confidence" | "empty" | "unprocessed" | "failed";
  requiresHumanReview?: boolean;
}

export type ExtractionStatus =
  "success" | "partial_ocr" | "scanned_ocr_required" | "text_limit_exceeded";

export interface PdfExtractionResult {
  extractionId: string;
  filename: string;
  pageCount: number;
  totalCharacters: number;
  extractionStatus: ExtractionStatus;
  pages: ExtractedPage[];
  processedPageCount: number;
  attemptedPageCount: number;
  ocrPageLimit?: number;
  warnings: string[];
  unprocessedPages?: number[];
  error?: string;
}

/**
 * Generates a collision-resistant unique extraction ID.
 */
export function generateExtractionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ext-${ts}-${rand}`;
}

/**
 * Conservative check: determines if extracted native text on a page is empty
 * or clearly insufficient (e.g. only page number, whitespace, or fewer than 3 words).
 */
export function isPageTextInsufficient(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < MIN_PAGE_TEXT_CHARS) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    return words.length < 3;
  }
  return false;
}

/**
 * Safely converts an uploaded File or Blob into a Uint8Array across runtimes (Node, Bun, jsdom).
 */
export async function getFileBytes(file: unknown): Promise<Uint8Array> {
  if (!file || typeof file !== "object") {
    throw new Error("Invalid file object");
  }

  const f = file as any;

  if (typeof f.bytes === "function") {
    return await f.bytes();
  }

  if (f._buffer && f._buffer instanceof Uint8Array) {
    return f._buffer;
  }

  if (Buffer.isBuffer(f)) {
    return new Uint8Array(f);
  }

  if (typeof f.arrayBuffer === "function") {
    try {
      const ab = await f.arrayBuffer();
      return new Uint8Array(ab);
    } catch {
      // Fallback if jsdom arrayBuffer is not fully implemented
    }
  }

  if (typeof f.text === "function") {
    const txt = await f.text();
    return new Uint8Array(Buffer.from(txt, "binary"));
  }

  throw new Error("Unable to extract bytes from uploaded file");
}

/**
 * Validates the raw file upload metadata and binary signature.
 */
export function validatePdfFile(
  file: File | Blob | null | undefined,
  buffer: Uint8Array,
): { valid: true } | { valid: false; status: 400 | 413 | 415; error: string } {
  if (!file) {
    return { valid: false, status: 400, error: "No file provided in form-data." };
  }

  // 1. File size validation (15 MB cap)
  if (buffer.length > MAX_PDF_SIZE_BYTES || ("size" in file && file.size > MAX_PDF_SIZE_BYTES)) {
    return {
      valid: false,
      status: 413,
      error: `File exceeds maximum allowed size of ${(MAX_PDF_SIZE_BYTES / (1024 * 1024)).toFixed(0)} MB (${(buffer.length / (1024 * 1024)).toFixed(1)} MB uploaded).`,
    };
  }

  if (buffer.length === 0) {
    return { valid: false, status: 400, error: "The uploaded file is empty (0 bytes)." };
  }

  // 2. File extension and MIME validation
  const filename = "name" in file ? file.name : "";
  const mimeType = "type" in file ? file.type : "";

  const hasPdfExtension = /\.pdf$/i.test(filename);
  const isPdfMime =
    mimeType === "application/pdf" || mimeType === "application/x-pdf" || mimeType === "";

  if (filename && !hasPdfExtension) {
    return {
      valid: false,
      status: 415,
      error: `Unsupported file type '${filename}'. Only PDF documents (.pdf) are supported.`,
    };
  }

  if (mimeType && !isPdfMime && !hasPdfExtension) {
    return {
      valid: false,
      status: 415,
      error: `Unsupported MIME type '${mimeType}'. Only PDF documents are supported.`,
    };
  }

  // 3. Binary magic bytes check (%PDF-)
  const header = String.fromCharCode(...buffer.slice(0, 5));
  if (header !== "%PDF-") {
    return {
      valid: false,
      status: 400,
      error:
        "Invalid PDF format: file lacks the standard '%PDF-' header signature. It may be corrupted or not a genuine PDF.",
    };
  }

  return { valid: true };
}

/**
 * Parses and extracts text page-by-page from a validated PDF buffer.
 * If any pages have empty or clearly insufficient text, it runs sequential OCR
 * fallback on those pages only, preserving native text on the rest.
 */
export async function extractTextFromPdf(
  buffer: Uint8Array,
  filename: string,
  ocrOptions: OcrProcessingOptions = {},
): Promise<PdfExtractionResult> {
  const extractionId = generateExtractionId();

  // Make an unattached copy of the buffer in case extractText detaches the original buffer
  const ocrBuffer = buffer.slice();

  let parsed: { totalPages: number; text: string[] };
  try {
    parsed = await extractText(buffer, { mergePages: false });
  } catch (err) {
    throw new Error(`PDF parsing failed: ${sanitizeError(err)}`);
  }

  const warnings: string[] = [];
  const rawPages: Array<{
    pageNumber: number;
    text: string;
    charCount: number;
    needsOcr: boolean;
  }> = [];
  const pagesToOcr: Array<{ pageNumber: number; existingText: string }> = [];

  for (let i = 0; i < parsed.totalPages; i++) {
    const rawText = parsed.text[i] ?? "";
    const cleanText = rawText.replace(/\r\n/g, "\n").trim();
    const charCount = cleanText.length;
    const pageNumber = i + 1;
    const needsOcr = isPageTextInsufficient(cleanText);

    if (needsOcr) {
      pagesToOcr.push({ pageNumber, existingText: cleanText });
    }

    rawPages.push({
      pageNumber,
      text: cleanText,
      charCount,
      needsOcr,
    });
  }

  // Step 2: Run OCR fallback if any page has empty or insufficient native text
  let ocrResults = new Map();
  let unprocessedPages: number[] = [];

  if (pagesToOcr.length > 0) {
    const ocrOutcome = await processPagesWithOcr(ocrBuffer, pagesToOcr, ocrOptions);
    ocrResults = ocrOutcome.results;
    unprocessedPages = ocrOutcome.unprocessedPages;
    if (ocrOutcome.warnings.length > 0) {
      warnings.push(...ocrOutcome.warnings);
    }
  }

  // Step 3: Assemble unified ExtractedPage array
  const pages: ExtractedPage[] = [];
  let totalCharacters = 0;
  let hasOcrFailures = false;

  for (const raw of rawPages) {
    if (raw.needsOcr && ocrResults.has(raw.pageNumber)) {
      const ocr = ocrResults.get(raw.pageNumber);
      const text = ocr.text || "";
      const charCount = text.length;
      totalCharacters += charCount;

      if (ocr.status === "failed" || ocr.status === "unprocessed") {
        hasOcrFailures = true;
      }

      pages.push({
        pageNumber: raw.pageNumber,
        text,
        characterCount: charCount,
        method: "ocr",
        confidence: ocr.confidence,
        ocrStatus: ocr.status,
        ocrWarning: ocr.warning,
        requiresHumanReview: Boolean(ocr.requiresHumanReview),
      });
    } else {
      totalCharacters += raw.charCount;
      pages.push({
        pageNumber: raw.pageNumber,
        text: raw.text,
        characterCount: raw.charCount,
        method: "native",
        confidence: null,
        requiresHumanReview: false,
      });
    }
  }

  const processedPageNumbers = new Set(
    pages
      .filter(
        (page) =>
          (page.method === "native" && page.text.trim().length > 0) ||
          page.ocrStatus === "success" ||
          page.ocrStatus === "low_confidence",
      )
      .map((page) => page.pageNumber),
  );
  const attemptedPageNumbers = new Set(
    pages
      .filter((page) => page.method === "native" || page.ocrStatus !== "unprocessed")
      .map((page) => page.pageNumber),
  );
  unprocessedPages = Array.from({ length: parsed.totalPages }, (_, index) => index + 1).filter(
    (pageNumber) => !processedPageNumbers.has(pageNumber),
  );

  // Memory safety check
  if (totalCharacters > MAX_EXTRACTED_CHARS) {
    return {
      extractionId,
      filename,
      pageCount: parsed.totalPages,
      totalCharacters,
      processedPageCount: processedPageNumbers.size,
      attemptedPageCount: attemptedPageNumbers.size,
      ocrPageLimit: ocrOptions.maxOcrPages ?? DEFAULT_MAX_OCR_PAGES,
      extractionStatus: "text_limit_exceeded",
      pages: [],
      warnings,
      error: `Extracted text exceeds the safe server limit of ${MAX_EXTRACTED_CHARS.toLocaleString()} characters.`,
    };
  }

  // Scanned / Image-only detection: if after OCR total characters are still below threshold
  if (totalCharacters < MIN_TEXT_CHARS_FOR_OCR_CHECK) {
    return {
      extractionId,
      filename,
      pageCount: parsed.totalPages,
      totalCharacters,
      processedPageCount: processedPageNumbers.size,
      attemptedPageCount: attemptedPageNumbers.size,
      ocrPageLimit: ocrOptions.maxOcrPages ?? DEFAULT_MAX_OCR_PAGES,
      extractionStatus: "scanned_ocr_required",
      pages,
      warnings: [
        ...warnings,
        `No machine-readable text found across ${parsed.totalPages} page(s). This document appears to be scanned or image-based.`,
      ],
      error:
        "This document appears to be a scanned or image-only PDF without embedded text. OCR (Optical Character Recognition) is not yet supported for blank scans; OCR (Optical Character Recognition) was unable to detect legible text.",
    };
  }

  // Partial OCR determination: if any pages could not be processed due to limits, timeouts, or errors
  if (unprocessedPages.length > 0 || hasOcrFailures) {
    return {
      extractionId,
      filename,
      pageCount: parsed.totalPages,
      totalCharacters,
      processedPageCount: processedPageNumbers.size,
      attemptedPageCount: attemptedPageNumbers.size,
      ocrPageLimit: ocrOptions.maxOcrPages ?? DEFAULT_MAX_OCR_PAGES,
      extractionStatus: "partial_ocr",
      pages,
      warnings,
      unprocessedPages,
    };
  }

  return {
    extractionId,
    filename,
    pageCount: parsed.totalPages,
    totalCharacters,
    processedPageCount: processedPageNumbers.size,
    attemptedPageCount: attemptedPageNumbers.size,
    ocrPageLimit: ocrOptions.maxOcrPages ?? DEFAULT_MAX_OCR_PAGES,
    extractionStatus: "success",
    pages,
    warnings,
  };
}
