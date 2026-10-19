import { describe, it, expect } from "vitest";
import { Route } from "@/routes/api.health";

describe("GET /api/health", () => {
  it("returns 200 OK with server status", async () => {
    const handler = Route.options.server?.handlers?.GET;
    expect(handler).toBeDefined();

    if (!handler) throw new Error("GET handler not found");

    const response = await handler({
      request: new Request("http://localhost/api/health"),
    } as Parameters<typeof handler>[0]);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(data.service).toBe("TenderTrap");
    expect(typeof data.timestamp).toBe("string");
    expect(typeof data.uptime).toBe("number");
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
  });

  it("accepts HEAD requests for crawler and uptime checks", async () => {
    const handler = Route.options.server?.handlers?.GET;
    expect(handler).toBeDefined();

    if (!handler) throw new Error("GET handler not found");

    const response = await handler({
      request: new Request("http://localhost/api/health", { method: "HEAD" }),
    } as Parameters<typeof handler>[0]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
  });

  it("rejects unsupported methods with an explicit Allow header", async () => {
    const handler = Route.options.server?.handlers?.GET;
    expect(handler).toBeDefined();

    if (!handler) throw new Error("GET handler not found");

    const response = await handler({
      request: new Request("http://localhost/api/health", { method: "POST" }),
    } as Parameters<typeof handler>[0]);

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});
