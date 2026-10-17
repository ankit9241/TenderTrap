import path from "node:path";
import fs from "node:fs";
import { createWorker, type Worker } from "tesseract.js";
import { renderPageAsImage } from "unpdf";
import { sanitizeError } from "./db";

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  confidence: number | null;
  status: "success" | "low_confidence" | "empty" | "unprocessed" | "failed";
  warning?: string;
  requiresHumanReview?: boolean;
}

export interface OcrProcessingOptions {
  maxOcrPages?: number;
  perPageTimeoutMs?: number;
  totalBudgetMs?: number;
  scale?: number;
  lowConfidenceThreshold?: number;
}

export const DEFAULT_MAX_OCR_PAGES = 15;
export const MIN_PAGE_TIMEOUT_MS = 3_000;
export const HARD_MAX_PAGE_TIMEOUT_MS = 45_000;

const envPageTimeout = Number(process.env["OCR_PAGE_TIMEOUT_MS"]);
export const DEFAULT_PER_PAGE_TIMEOUT_MS =
  !isNaN(envPageTimeout) && envPageTimeout > 0
    ? Math.min(Math.max(envPageTimeout, MIN_PAGE_TIMEOUT_MS), HARD_MAX_PAGE_TIMEOUT_MS)
    : 15_000;

export const DEFAULT_TOTAL_BUDGET_MS = 60_000;
export const DEFAULT_OCR_SCALE = 2.0;
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 40;

/**
 * Checks whether the bundled tessdata directory contains traineddata for a given language code.
 */
export function isLanguageSupported(lang: string): boolean {
  const { langPath } = resolveTessdataPath();
  return fs.existsSync(path.join(langPath, `${lang}.traineddata`));
}

/**
 * Resolves the directory containing eng.traineddata.
 * Priority:
 * 1. Process environment variable OCR_LANG_PATH / TESSDATA_PREFIX
 * 2. ./tessdata
 * 3. ./public/tessdata
 * 4. Fallback to process.cwd()
 */
export function resolveTessdataPath(): { langPath: string; isLocal: boolean } {
  const envPath = process.env["OCR_LANG_PATH"] || process.env["TESSDATA_PREFIX"];
  if (envPath && fs.existsSync(path.join(envPath, "eng.traineddata"))) {
    return { langPath: envPath, isLocal: true };
  }

  const cwdTessdata = path.resolve(process.cwd(), "tessdata");
  if (fs.existsSync(path.join(cwdTessdata, "eng.traineddata"))) {
    return { langPath: cwdTessdata, isLocal: true };
  }

  const publicTessdata = path.resolve(process.cwd(), "public/tessdata");
  if (fs.existsSync(path.join(publicTessdata, "eng.traineddata"))) {
    return { langPath: publicTessdata, isLocal: true };
  }

  return { langPath: process.cwd(), isLocal: false };
}

/**
 * Initializes a single Tesseract worker with local traineddata and explicit paths when available.
 */
export async function initializeOcrWorker(): Promise<Worker> {
  const { langPath, isLocal } = resolveTessdataPath();

  const options: Record<string, any> = {
    gzip: false,
  };

  const workerPath = path.resolve(process.cwd(), "node_modules/tesseract.js/src/worker-script/node/index.js");
  if (fs.existsSync(workerPath)) {
    options["workerPath"] = workerPath;
  }

  const corePath = path.resolve(process.cwd(), "node_modules/tesseract.js-core/tesseract-core.wasm.js");
  if (fs.existsSync(corePath)) {
    options["corePath"] = corePath;
  }

  if (isLocal) {
    options["langPath"] = langPath;
    options["cacheMethod"] = "readOnly";
  }

  return await createWorker("eng", 1, options);
}

/**
 * Renders a single PDF page to a PNG buffer using unpdf and @napi-rs/canvas.
 */
export async function renderPdfPageToImage(
  pdfBuffer: Uint8Array,
  pageNumber: number,
  scale = DEFAULT_OCR_SCALE,
): Promise<Buffer> {
  try {
    // Ensure an unshared, unpooled clean ArrayBuffer is passed to PDF.js worker
    const cleanBuffer = new Uint8Array(pdfBuffer.byteLength);
    cleanBuffer.set(pdfBuffer);

    const arrayBuf = await renderPageAsImage(cleanBuffer, pageNumber, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale,
    });
    return Buffer.from(arrayBuf);
  } catch (err) {
    throw new Error(`Failed to render PDF page ${pageNumber} to image: ${sanitizeError(err)}`);
  }
}

// Optional mock for testing timeout, low confidence, and failures deterministically
type MockOcrHandler = (pageNumber: number) => Promise<{ text: string; confidence: number }> | null;
let mockOcrHandler: MockOcrHandler | null = null;

export function setMockOcrHandler(handler: MockOcrHandler | null): void {
  mockOcrHandler = handler;
}

/**
 * Performs sequential OCR on a list of target pages using a single reused Tesseract worker.
 * Bounded by maxOcrPages, perPageTimeout, and an overall request budget.
 */
export async function processPagesWithOcr(
  pdfBuffer: Uint8Array,
  targetPages: Array<{ pageNumber: number; existingText?: string }>,
  options: OcrProcessingOptions = {},
): Promise<{
  results: Map<number, OcrPageResult>;
  unprocessedPages: number[];
  warnings: string[];
}> {
  const maxPages = options.maxOcrPages ?? DEFAULT_MAX_OCR_PAGES;
  const rawTimeout = options.perPageTimeoutMs ?? DEFAULT_PER_PAGE_TIMEOUT_MS;
  const perPageTimeout = Math.min(Math.max(rawTimeout, MIN_PAGE_TIMEOUT_MS), HARD_MAX_PAGE_TIMEOUT_MS);
  const totalBudget = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  const scale = options.scale ?? DEFAULT_OCR_SCALE;
  const lowConfidenceThreshold = options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;

  const results = new Map<number, OcrPageResult>();
  const unprocessedPages: number[] = [];
  const warnings: string[] = [];

  const pagesToProcess = targetPages.slice(0, maxPages);
  const excessPages = targetPages.slice(maxPages);

  for (const p of excessPages) {
    unprocessedPages.push(p.pageNumber);
    results.set(p.pageNumber, {
      pageNumber: p.pageNumber,
      text: p.existingText || "",
      confidence: null,
      status: "unprocessed",
      warning: `OCR skipped: Document exceeded the maximum OCR page limit of ${maxPages} pages.`,
      requiresHumanReview: true,
    });
  }

  if (excessPages.length > 0) {
    warnings.push(
      `Document contains ${targetPages.length} scanned/image-only pages. Only the first ${maxPages} pages were processed by OCR (exceeded the maximum OCR page limit of ${maxPages} pages). Remaining ${excessPages.length} pages (${excessPages.map((p) => p.pageNumber).join(", ")}) were not processed.`,
    );
  }

  if (pagesToProcess.length === 0) {
    return { results, unprocessedPages, warnings };
  }

  let worker: Worker | null = null;
  const startTime = Date.now();

  try {
    // Only initialize the real Tesseract worker if not purely using a mock handler
    if (!mockOcrHandler) {
      worker = await initializeOcrWorker();
    }

    for (let i = 0; i < pagesToProcess.length; i++) {
      const target = pagesToProcess[i]!;
      const pageNum = target.pageNumber;

      // Check total time budget
      const elapsed = Date.now() - startTime;
      if (elapsed >= totalBudget) {
        // Mark this and all subsequent pages as unprocessed due to total timeout
        for (let j = i; j < pagesToProcess.length; j++) {
          const rem = pagesToProcess[j]!;
          unprocessedPages.push(rem.pageNumber);
          results.set(rem.pageNumber, {
            pageNumber: rem.pageNumber,
            text: rem.existingText || "",
            confidence: null,
            status: "unprocessed",
            warning: `OCR budget exceeded (${totalBudget}ms limit reached). Page ${rem.pageNumber} was not processed.`,
            requiresHumanReview: true,
          });
        }
        warnings.push(
          `OCR processing stopped because the total budget of ${totalBudget / 1000}s was reached. Pages ${pagesToProcess.slice(i).map((p) => p.pageNumber).join(", ")} remain unprocessed.`,
        );
        break;
      }

      // Process single page with per-page timeout
      try {
        const pagePromise = (async () => {
          if (mockOcrHandler) {
            const mockRes = await mockOcrHandler(pageNum);
            if (mockRes) return mockRes;
          }

          const imageBuffer = await renderPdfPageToImage(pdfBuffer.slice(), pageNum, scale);
          if (!worker) {
            worker = await initializeOcrWorker();
          }
          const ocrResult = await worker.recognize(imageBuffer);
          return {
            text: ocrResult.data.text || "",
            confidence: typeof ocrResult.data.confidence === "number" ? Math.round(ocrResult.data.confidence) : null,
          };
        })();

        // Per-page timeout safeguard
        let timeoutHandle: any;
        const timeoutPromise = new Promise<{ text: string; confidence: number | null }>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`OCR timeout on page ${pageNum} (${perPageTimeout}ms exceeded)`));
          }, perPageTimeout);
        });

        pagePromise.catch(() => {});

        const outcome = await Promise.race([pagePromise, timeoutPromise]).finally(() => {
          clearTimeout(timeoutHandle);
        });

        const rawText = outcome.text.replace(/\r\n/g, "\n").trim();
        const conf = outcome.confidence;

        // If native text already existed, preserve it
        let finalText = rawText;
        if (target.existingText && target.existingText.trim()) {
          const cleanNative = target.existingText.trim();
          if (cleanNative && !finalText.includes(cleanNative)) {
            finalText = `${cleanNative}\n\n${finalText}`.trim();
          }
        }

        if (!finalText) {
          results.set(pageNum, {
            pageNumber: pageNum,
            text: "",
            confidence: conf,
            status: "empty",
            warning: `Page ${pageNum}: No text could be recognized from the page image.`,
            requiresHumanReview: true,
          });
        } else if (conf !== null && conf < lowConfidenceThreshold) {
          results.set(pageNum, {
            pageNumber: pageNum,
            text: finalText,
            confidence: conf,
            status: "low_confidence",
            warning: `Page ${pageNum}: OCR confidence is low (${conf}% < ${lowConfidenceThreshold}% threshold). Text may contain inaccuracies and requires human review.`,
            requiresHumanReview: true,
          });
        } else {
          results.set(pageNum, {
            pageNumber: pageNum,
            text: finalText,
            confidence: conf,
            status: "success",
            requiresHumanReview: false,
          });
        }
      } catch (pageErr) {
        if (worker) {
          try {
            await worker.terminate();
          } catch {
            // Suppress error when terminating broken worker
          }
          worker = null;
        }
        const errorMsg = sanitizeError(pageErr);
        results.set(pageNum, {
          pageNumber: pageNum,
          text: target.existingText || "",
          confidence: null,
          status: "failed",
          warning: `Page ${pageNum} OCR failed: ${errorMsg}`,
          requiresHumanReview: true,
        });
        warnings.push(`Page ${pageNum} OCR failed: ${errorMsg}`);
      }
    }
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // Suppress termination errors during cleanup
      }
    }
  }

  return { results, unprocessedPages, warnings };
}
