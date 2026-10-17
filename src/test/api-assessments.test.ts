import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Route as ListRoute } from "@/routes/api.assessments.index";
import { Route as DetailRoute } from "@/routes/api.assessments.$id";
import { setMockDb } from "@/lib/server/db";
import type { Db } from "mongodb";

describe("/api/assessments endpoints", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setMockDb(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setMockDb(null);
  });

  describe("GET /api/assessments", () => {
    it("returns 503 when MONGODB_URI is not set", async () => {
      delete process.env.MONGODB_URI;
      const handler = ListRoute.options.server?.handlers?.GET;
      const res = await handler!({} as any);
      expect(res.status).toBe(503);
    });

    it("returns 200 with list of assessments from database", async () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017";
      const sampleAssessments = [
        {
          id: "as-1",
          title: "Mysuru Ring Road Expansion",
          authority: "NHAI",
          createdAt: "2026-10-15T10:00:00.000Z",
        },
      ];

      const mockDb = {
        collection: () => ({
          find: () => ({
            sort: () => ({
              toArray: async () => sampleAssessments,
            }),
          }),
        }),
      } as unknown as Db;
      setMockDb(mockDb);

      const handler = ListRoute.options.server?.handlers?.GET;
      const res = await handler!({} as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.count).toBe(1);
      expect(body.assessments[0].title).toBe("Mysuru Ring Road Expansion");
    });
  });

  describe("GET /api/assessments/:id", () => {
    it("returns 400 when id is missing or whitespace", async () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017";
      const handler = DetailRoute.options.server?.handlers?.GET;
      const res = await handler!({ params: { id: "   " } } as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid assessment ID");
    });

    it("returns 404 when assessment is not found", async () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017";
      const mockDb = {
        collection: () => ({
          findOne: async () => null,
        }),
      } as unknown as Db;
      setMockDb(mockDb);

      const handler = DetailRoute.options.server?.handlers?.GET;
      const res = await handler!({ params: { id: "as-nonexistent" } } as any);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("not found");
    });

    it("returns 200 with assessment when found", async () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017";
      const sample = {
        id: "as-42",
        title: "Kaveri River Bridge Construction",
        authority: "Karnataka PWD",
        reference: "PWD/2026/042",
        createdAt: "2026-10-16T08:00:00.000Z",
      };

      const mockDb = {
        collection: () => ({
          findOne: async ({ id }: any) => (id === "as-42" ? sample : null),
        }),
      } as unknown as Db;
      setMockDb(mockDb);

      const handler = DetailRoute.options.server?.handlers?.GET;
      const res = await handler!({ params: { id: "as-42" } } as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.assessment.title).toBe("Kaveri River Bridge Construction");
    });
  });

  describe("POST /api/assessments", () => {
    it("returns 503 when MONGODB_URI is not set", async () => {
      delete process.env.MONGODB_URI;
      const handler = ListRoute.options.server?.handlers?.POST;
      const res = await handler!({
        request: new Request("http://localhost/api/assessments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "as-1", title: "Test", requirements: [] }),
        }),
      } as any);
      expect(res.status).toBe(503);
    });

    it("returns 400 for invalid body or missing id/title", async () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017";
      const handler = ListRoute.options.server?.handlers?.POST;

      const resNoId = await handler!({
        request: new Request("http://localhost/api/assessments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Test", requirements: [] }),
        }),
      } as any);
      expect(resNoId.status).toBe(400);

      const resNoReqs = await handler!({
        request: new Request("http://localhost/api/assessments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "as-1", title: "Test" }),
        }),
      } as any);
      expect(resNoReqs.status).toBe(400);
    });

    it("returns 201 with saved assessment when valid", async () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017";
      let replacedDoc: any = null;
      const mockDb = {
        collection: () => ({
          replaceOne: async (filter: any, doc: any) => {
            replacedDoc = doc;
            return { acknowledged: true };
          },
        }),
      } as unknown as Db;
      setMockDb(mockDb);

      const handler = ListRoute.options.server?.handlers?.POST;
      const payload = {
        id: "as-new-100",
        title: "Solar plant installation",
        reference: "SOLAR/2026/01",
        requirements: [{ id: "r1", title: "Valid registration", status: "MET" }],
        evidenceSnapshot: [{ id: "ev1", label: "Registration", kind: "registration", detail: "Active" }],
        documents: [],
      };

      const res = await handler!({
        request: new Request("http://localhost/api/assessments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      } as any);

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.assessment.id).toBe("as-new-100");
      expect(data.assessment.title).toBe("Solar plant installation");
      expect(replacedDoc).not.toBeNull();
      expect(replacedDoc.id).toBe("as-new-100");
    });
  });
});
