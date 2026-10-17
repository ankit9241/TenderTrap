import { describe, it, expect } from "vitest";
import { Route } from "@/routes/api.health";

describe("GET /api/health", () => {
  it("returns 200 OK with server status", async () => {
    const handler = Route.options.server?.handlers?.GET;
    expect(handler).toBeDefined();

    if (!handler) throw new Error("GET handler not found");

    const response = await handler({} as any);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(data.service).toBe("TenderTrap");
    expect(typeof data.timestamp).toBe("string");
    expect(typeof data.uptime).toBe("number");
  });
});
