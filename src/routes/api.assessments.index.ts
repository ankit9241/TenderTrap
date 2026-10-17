import { createFileRoute } from "@tanstack/react-router";
import { getCollections, isMongoConfigured, sanitizeError } from "@/lib/server/db";

export const Route = createFileRoute("/api/assessments/")({
  server: {
    handlers: {
      GET: async () => {
        if (!isMongoConfigured()) {
          return Response.json(
            { error: "Database not connected. MONGODB_URI is required." },
            { status: 503 },
          );
        }

        try {
          const { assessments } = await getCollections();
          const list = await assessments
            .find({}, { projection: { _id: 0 } })
            .sort({ createdAt: -1 })
            .toArray();

          return Response.json(
            {
              assessments: list,
              count: list.length,
            },
            { status: 200 },
          );
        } catch (err) {
          return Response.json(
            { error: `Failed to fetch assessments: ${sanitizeError(err)}` },
            { status: 500 },
          );
        }
      },

      POST: async ({ request }) => {
        if (!isMongoConfigured()) {
          return Response.json(
            { error: "Database not connected. MONGODB_URI is required." },
            { status: 503 },
          );
        }

        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
        }

        if (!body || typeof body !== "object") {
          return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
        }

        if (typeof body.id !== "string" || !body.id.trim()) {
          return Response.json({ error: "id is required and must be a non-empty string" }, { status: 400 });
        }

        if (typeof body.title !== "string" || !body.title.trim()) {
          return Response.json({ error: "title is required and must be a non-empty string" }, { status: 400 });
        }

        if (!Array.isArray(body.requirements)) {
          return Response.json({ error: "requirements must be an array" }, { status: 400 });
        }

        try {
          const { assessments } = await getCollections();
          const assessment = {
            id: body.id.trim(),
            demo: Boolean(body.demo),
            title: body.title.trim(),
            reference: typeof body.reference === "string" ? body.reference.trim() : "",
            authority: typeof body.authority === "string" ? body.authority.trim() : "",
            procurementSource: typeof body.procurementSource === "string" ? body.procurementSource.trim() : "",
            deadline: typeof body.deadline === "string" ? body.deadline : null,
            emdAmount: typeof body.emdAmount === "string" ? body.emdAmount : undefined,
            companyId: typeof body.companyId === "string" ? body.companyId : "co-default",
            evidenceSnapshot: Array.isArray(body.evidenceSnapshot) ? body.evidenceSnapshot : [],
            documents: Array.isArray(body.documents) ? body.documents : [],
            requirements: body.requirements,
            createdAt: typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await assessments.replaceOne(
            { id: assessment.id },
            assessment,
            { upsert: true },
          );

          return Response.json({ assessment }, { status: 201 });
        } catch (err) {
          return Response.json(
            { error: `Failed to save assessment: ${sanitizeError(err)}` },
            { status: 500 },
          );
        }
      },
    },
  },
});
