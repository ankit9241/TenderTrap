import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Route } from "@/routes/api.company";
import { setMockDb } from "@/lib/server/db";
import type { Db } from "mongodb";

describe("/api/company endpoints", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setMockDb(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setMockDb(null);
  });

  describe("GET /api/company", () => {
    it("returns 503 when MONGODB_URI is not set", async () => {
      delete process.env.MONGODB_URI;
      const getHandler = Route.options.server?.handlers?.GET;
      const res = await getHandler!({} as any);
      expect(res.status).toBe(503);
    });

    it("returns 404 when company profile does not exist", async () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017";
      const mockDb = {
        collection: () => ({
          findOne: async () => null,
        }),
      } as unknown as Db;
      setMockDb(mockDb);

      const getHandler = Route.options.server?.handlers?.GET;
      const res = await getHandler!({} as any);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("not found");
    });

    it("returns 200 with company profile when found", async () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017";
      const sampleCompany = {
        id: "co-test",
        legalName: "Apex Infra Private Limited",
        businessType: "Private Limited",
        identifiers: "CIN: U45200MH2020PTC123456",
        address: "Bengaluru, Karnataka",
        turnover: [],
        projects: [],
        registrations: [],
        updatedAt: "2026-10-16T12:00:00.000Z",
      };

      const mockDb = {
        collection: () => ({
          findOne: async () => sampleCompany,
        }),
      } as unknown as Db;
      setMockDb(mockDb);

      const getHandler = Route.options.server?.handlers?.GET;
      const res = await getHandler!({} as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.company.legalName).toBe("Apex Infra Private Limited");
    });
  });

  describe("PUT /api/company", () => {
    it("returns 400 when body is invalid JSON or missing legalName", async () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017";
      const putHandler = Route.options.server?.handlers?.PUT;

      // Invalid JSON / empty object
      const req1 = new Request("http://localhost/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res1 = await putHandler!({ request: req1 } as any);
      expect(res1.status).toBe(400);
      const data1 = await res1.json();
      expect(data1.error).toContain("legalName is required");
    });

    it("returns 200 and upserts company profile when body is valid", async () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017";
      let savedDoc: any = null;

      const mockDb = {
        collection: () => ({
          replaceOne: async (_filter: any, doc: any) => {
            savedDoc = doc;
            return { acknowledged: true };
          },
        }),
      } as unknown as Db;
      setMockDb(mockDb);

      const putHandler = Route.options.server?.handlers?.PUT;
      const validPayload = {
        id: "co-123",
        legalName: "Karnataka Civil Projects Ltd",
        businessType: "Public Limited",
        identifiers: "GSTIN: 29ABCDE1234F1Z5",
        address: "Hubballi, Karnataka",
        turnover: [{ id: "to-1", financialYear: "FY 2024-25", amountInr: 15000000, state: "reviewed" }],
        projects: [],
        registrations: [],
      };

      const req = new Request("http://localhost/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload),
      });

      const res = await putHandler!({ request: req } as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.company.legalName).toBe("Karnataka Civil Projects Ltd");
      expect(savedDoc).toBeDefined();
      expect(savedDoc.legalName).toBe("Karnataka Civil Projects Ltd");
      expect(typeof savedDoc.updatedAt).toBe("string");
    });
  });
});
