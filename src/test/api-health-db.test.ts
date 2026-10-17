import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Route } from "@/routes/api.health.db";
import { setMockDb } from "@/lib/server/db";
import type { Db } from "mongodb";

describe("GET /api/health/db", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setMockDb(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setMockDb(null);
  });

  it("returns 503 disconnected when MONGODB_URI is not set", async () => {
    delete process.env.MONGODB_URI;

    const handler = Route.options.server?.handlers?.GET;
    expect(handler).toBeDefined();

    const response = await handler!({} as any);
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("disconnected");
    expect(body.message).toContain("MONGODB_URI is not configured");
  });

  it("returns 200 connected when database ping succeeds", async () => {
    const mockDb = {
      command: async (cmd: any) => {
        if (cmd.ping === 1) return { ok: 1 };
        throw new Error("fail");
      },
    } as unknown as Db;

    setMockDb(mockDb);

    const handler = Route.options.server?.handlers?.GET;
    const response = await handler!({} as any);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("connected");
    expect(body.database).toBe("tendertrap");
    expect(typeof body.timestamp).toBe("string");
  });
});
