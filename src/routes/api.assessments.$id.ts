import { createFileRoute } from "@tanstack/react-router";
import { getCollections, isMongoConfigured, sanitizeError } from "@/lib/server/db";

export const Route = createFileRoute("/api/assessments/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!isMongoConfigured()) {
          return Response.json(
            { error: "Database not connected. MONGODB_URI is required." },
            { status: 503 },
          );
        }

        const assessmentId = params?.id?.trim();
        if (!assessmentId) {
          return Response.json({ error: "Invalid assessment ID" }, { status: 400 });
        }

        try {
          const { assessments } = await getCollections();
          const doc = await assessments.findOne({ id: assessmentId }, { projection: { _id: 0 } });

          if (!doc) {
            return Response.json({ error: `Assessment '${assessmentId}' not found` }, { status: 404 });
          }

          return Response.json({ assessment: doc }, { status: 200 });
        } catch (err) {
          return Response.json(
            { error: `Failed to fetch assessment: ${sanitizeError(err)}` },
            { status: 500 },
          );
        }
      },
    },
  },
});
