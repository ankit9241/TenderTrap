import { createFileRoute } from "@tanstack/react-router";
import { validatePdfFile, extractTextFromPdf, getFileBytes, generateExtractionId } from "@/lib/server/pdf";
import { analyzeTenderPages } from "@/lib/server/llm";

function handleLlmError(err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("timed out")) {
    return Response.json(
      { error: "Model extraction request timed out. Please try again with a smaller document or check model load.", details: msg },
      { status: 504 },
    );
  }

  if (msg.includes("token repeat limit")) {
    return Response.json(
      { error: "Model generation encountered repetitive output from the local model. Parameters have been adjusted; please retry extraction.", details: msg },
      { status: 502 },
    );
  }

  if (msg.includes("Ollama connection failed") || msg.includes("Ollama service unreachable") || msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    return Response.json(
      { error: "LLM extraction service is currently unavailable. Please verify the model provider is running.", details: msg },
      { status: 503 },
    );
  }

  if (msg.includes("Schema validation failed") || msg.includes("malformed JSON")) {
    return Response.json(
      { error: "The AI model produced an invalid response structure.", details: msg },
      { status: 502 },
    );
  }

  return Response.json(
    { error: "Tender analysis failed.", details: msg },
    { status: 500 },
  );
}

export const Route = createFileRoute("/api/tenders/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers?.get?.("content-type") || "";

        // Flow A: Existing extraction JSON payload
        if (contentType.includes("application/json")) {
          let body: any;
          try {
            body = await request.json();
          } catch {
            return Response.json({ error: "Malformed JSON payload." }, { status: 400 });
          }

          const payload = body.extraction || body;
          if (!payload || !Array.isArray(payload.pages) || typeof payload.filename !== "string") {
            return Response.json(
              { error: "Invalid extraction payload. Request must contain 'pages' array and 'filename'." },
              { status: 400 },
            );
          }

          if (payload.extractionStatus === "scanned_ocr_required") {
            return Response.json(payload, { status: 422 });
          }

          if (payload.extractionStatus === "text_limit_exceeded") {
            return Response.json(payload, { status: 413 });
          }

          const usablePagesCount = payload.pages.filter(
            (p: any) => p && typeof p.text === "string" && p.text.trim().length > 0,
          ).length;

          if (usablePagesCount === 0) {
            return Response.json(
              {
                error: "No usable text could be extracted from this document for requirement analysis.",
                extractionStatus: payload.extractionStatus || "scanned_ocr_required",
                pageCount: payload.pageCount ?? payload.pages.length,
                analyzedPageCount: 0,
                unprocessedPages: payload.unprocessedPages ?? [],
                warnings: payload.warnings ?? [],
              },
              { status: 422 },
            );
          }

          try {
            const analysis = await analyzeTenderPages(
              payload.pages,
              payload.filename,
              payload.extractionId || generateExtractionId(),
              {
                totalPageCount: payload.pageCount ?? payload.pages.length,
                unprocessedPages: payload.unprocessedPages,
                extractionStatus: payload.extractionStatus === "partial_ocr" ? "partial_ocr" : "success",
                warnings: payload.warnings,
              },
            );
            return Response.json(analysis, { status: 200 });
          } catch (err: unknown) {
            return handleLlmError(err);
          }
        }

        // Flow B: Raw PDF multipart/form-data upload
        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return Response.json(
            { error: "Malformed multipart/form-data request. Please ensure content-type is multipart/form-data or application/json." },
            { status: 400 },
          );
        }

        const file = formData.get("file");
        if (!file || typeof file === "string") {
          return Response.json(
            { error: "No file provided in form-data. Please upload a PDF under the 'file' field or pass existing extraction JSON." },
            { status: 400 },
          );
        }

        const filename = (file as File).name || "tender.pdf";
        let buffer: Uint8Array;
        try {
          buffer = await getFileBytes(file);
        } catch {
          return Response.json(
            { error: "Unable to read uploaded file data." },
            { status: 400 },
          );
        }

        // Validate size, extension, MIME type, and binary header
        const validation = validatePdfFile(file as Blob, buffer);
        if (!validation.valid) {
          return Response.json({ error: validation.error }, { status: validation.status });
        }

        // Step 1: Extract text page-by-page
        let extraction: Awaited<ReturnType<typeof extractTextFromPdf>>;
        try {
          extraction = await extractTextFromPdf(buffer, filename);
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed to extract text from PDF." },
            { status: 400 },
          );
        }

        if (extraction.extractionStatus === "scanned_ocr_required") {
          return Response.json(extraction, { status: 422 });
        }

        if (extraction.extractionStatus === "text_limit_exceeded") {
          return Response.json(extraction, { status: 413 });
        }

        const usablePagesCount = extraction.pages.filter((p) => p.text && p.text.trim().length > 0).length;
        if (usablePagesCount === 0) {
          return Response.json(
            {
              error: "No usable text could be extracted from this document for requirement analysis.",
              extractionStatus: extraction.extractionStatus,
              pageCount: extraction.pageCount,
              analyzedPageCount: 0,
              unprocessedPages: extraction.unprocessedPages ?? [],
              warnings: extraction.warnings,
            },
            { status: 422 },
          );
        }

        // Step 2: Analyze requirements with Gemma LLM
        try {
          const analysis = await analyzeTenderPages(
            extraction.pages,
            filename,
            extraction.extractionId,
            {
              totalPageCount: extraction.pageCount,
              unprocessedPages: extraction.unprocessedPages,
              extractionStatus: extraction.extractionStatus === "partial_ocr" ? "partial_ocr" : "success",
              warnings: extraction.warnings,
            },
          );
          return Response.json(analysis, { status: 200 });
        } catch (err: unknown) {
          return handleLlmError(err);
        }
      },
    },
  },
});
