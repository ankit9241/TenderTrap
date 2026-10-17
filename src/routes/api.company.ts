import { createFileRoute } from "@tanstack/react-router";
import { getCollections, isMongoConfigured, sanitizeError } from "@/lib/server/db";
import type { CompanyProfile } from "@/types/tender";

function validateCompanyInput(body: unknown): { valid: true; data: CompanyProfile } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const b = body as Partial<CompanyProfile>;

  if (typeof b.legalName !== "string" || !b.legalName.trim()) {
    return { valid: false, error: "legalName is required and must be a non-empty string" };
  }

  if (typeof b.businessType !== "string") {
    return { valid: false, error: "businessType must be a string" };
  }

  const turnover = Array.isArray(b.turnover) ? b.turnover : [];
  const projects = Array.isArray(b.projects) ? b.projects : [];
  const registrations = Array.isArray(b.registrations) ? b.registrations : [];

  const profile: CompanyProfile = {
    id: typeof b.id === "string" && b.id.trim() ? b.id.trim() : "co-default",
    legalName: b.legalName.trim(),
    businessType: b.businessType.trim(),
    identifiers: typeof b.identifiers === "string" ? b.identifiers.trim() : "",
    address: typeof b.address === "string" ? b.address.trim() : "",
    turnover,
    projects,
    registrations,
    updatedAt: new Date().toISOString(),
  };

  return { valid: true, data: profile };
}

export const Route = createFileRoute("/api/company")({
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
          const { companies } = await getCollections();
          const doc = await companies.findOne({}, { projection: { _id: 0 } });

          if (!doc) {
            return Response.json(
              { error: "Company profile not found in database" },
              { status: 404 },
            );
          }

          return Response.json({ company: doc }, { status: 200 });
        } catch (err) {
          return Response.json(
            { error: `Failed to fetch company profile: ${sanitizeError(err)}` },
            { status: 500 },
          );
        }
      },

      PUT: async ({ request }) => {
        if (!isMongoConfigured()) {
          return Response.json(
            { error: "Database not connected. MONGODB_URI is required." },
            { status: 503 },
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
        }

        const validation = validateCompanyInput(body);
        if (!validation.valid) {
          return Response.json({ error: validation.error }, { status: 400 });
        }

        try {
          const { companies } = await getCollections();
          const company = validation.data;

          await companies.replaceOne(
            { id: company.id },
            company,
            { upsert: true },
          );

          return Response.json({ company }, { status: 200 });
        } catch (err) {
          return Response.json(
            { error: `Failed to save company profile: ${sanitizeError(err)}` },
            { status: 500 },
          );
        }
      },
    },
  },
});
