import { createFileRoute } from "@tanstack/react-router";
import { validatePdfFile, extractTextFromPdf, getFileBytes } from "@/lib/server/pdf";

export const Route = createFileRoute("/api/tenders/extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return Response.json(
            { error: "Malformed multipart/form-data request. Please ensure content-type is multipart/form-data." },
            { status: 400 },
          );
        }

        const file = formData.get("file");
        if (!file || typeof file === "string") {
          return Response.json(
            { error: "No file provided in form-data. Please upload a PDF under the 'file' field." },
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

        try {
          const result = await extractTextFromPdf(buffer, filename);

          if (result.extractionStatus === "scanned_ocr_required") {
            return Response.json(result, { status: 422 });
          }

          if (result.extractionStatus === "text_limit_exceeded") {
            return Response.json(result, { status: 413 });
          }

          return Response.json(result, { status: 200 });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed to parse PDF document." },
            { status: 400 },
          );
        }
      },
    },
  },
});
