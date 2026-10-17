import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getMongoConfig,
  sanitizeMongoUri,
  sanitizeError,
  setMockDb,
  checkMongoConnection,
} from "./db";
import type { Db } from "mongodb";

describe("MongoDB Server Connection Module", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setMockDb(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setMockDb(null);
  });

  it("reads configuration from environment variables with safe defaults", () => {
    delete process.env.MONGODB_URI;
    delete process.env.MONGODB_DB_NAME;

    const conf = getMongoConfig();
    expect(conf.uri).toBeNull();
    expect(conf.dbName).toBe("tendertrap");

    process.env.MONGODB_URI = "mongodb+srv://user:pass@cluster.mongodb.net";
    process.env.MONGODB_DB_NAME = "custom_tenders";

    const custom = getMongoConfig();
    expect(custom.uri).toBe("mongodb+srv://user:pass@cluster.mongodb.net");
    expect(custom.dbName).toBe("custom_tenders");
  });

  it("sanitizes MongoDB URIs and error strings to never leak passwords", () => {
    const rawUri = "mongodb+srv://admin_user:SuperSecret123@cluster0.abcde.mongodb.net/prod";
    const sanitized = sanitizeMongoUri(rawUri);
    expect(sanitized).toBe("mongodb+srv://admin_user:***@cluster0.abcde.mongodb.net/prod");
    expect(sanitized).not.toContain("SuperSecret123");

    const error = new Error(`Connection failed: ${rawUri}`);
    const sanitizedMsg = sanitizeError(error);
    expect(sanitizedMsg).toContain("***@");
    expect(sanitizedMsg).not.toContain("SuperSecret123");
  });

  it("returns disconnected status when MONGODB_URI is absent", async () => {
    delete process.env.MONGODB_URI;
    const result = await checkMongoConnection();
    expect(result.connected).toBe(false);
    expect(result.error).toContain("MONGODB_URI is not configured");
  });

  it("reports connected when mock db ping succeeds", async () => {
    const mockDb = {
      command: async (cmd: any) => {
        if (cmd.ping === 1) return { ok: 1 };
        throw new Error("Unknown command");
      },
    } as unknown as Db;

    setMockDb(mockDb);
    const result = await checkMongoConnection();
    expect(result.connected).toBe(true);
    expect(result.database).toBe("tendertrap");
  });
});
