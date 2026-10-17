import { MongoClient, type Db, type Collection } from "mongodb";
import type { Assessment, CompanyProfile } from "@/types/tender";

/**
 * Server-only MongoDB connection manager.
 * Keeps a cached client instance across server requests.
 * Database credentials remain strictly on the server and are never sent to clients.
 */

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;
let mockDbInstance: Db | null = null;

const DEFAULT_DB_NAME = "tendertrap";

export function getMongoConfig(): { uri: string | null; dbName: string } {
  const uri = (process.env.MONGODB_URI || process.env.MONGO_URI)?.trim() || null;
  const dbName = process.env.MONGODB_DB_NAME?.trim() || DEFAULT_DB_NAME;
  return { uri, dbName };
}

export function isMongoConfigured(): boolean {
  return Boolean((process.env.MONGODB_URI || process.env.MONGO_URI)?.trim());
}

/**
 * Strips password and sensitive credentials from MongoDB URIs or connection strings.
 */
export function sanitizeMongoUri(uri: string): string {
  try {
    return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^:@\s]+):([^@\s]+)@/i, "$1$2:***@");
  } catch {
    return "mongodb://***";
  }
}

/**
 * Safely sanitizes error messages to prevent connection string or credential leaks.
 */
export function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    const raw = err.message;
    return raw.replace(/(mongodb(?:\+srv)?:\/\/)([^:@\s]+):([^@\s]+)@/gi, "$1$2:***@");
  }
  return "Unknown database error";
}

/**
 * For testing purposes: inject a mock database instance.
 */
export function setMockDb(mock: Db | null): void {
  mockDbInstance = mock;
}

/**
 * Returns a connected MongoClient instance.
 */
export async function getMongoClient(): Promise<MongoClient> {
  const { uri } = getMongoConfig();

  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  if (client) {
    return client;
  }

  if (!clientPromise) {
    const newClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    clientPromise = newClient
      .connect()
      .then((connected) => {
        client = connected;
        return connected;
      })
      .catch((err) => {
        clientPromise = null;
        throw new Error(`Database connection failed: ${sanitizeError(err)}`);
      });
  }

  return clientPromise;
}

/**
 * Returns the active MongoDB database instance.
 */
export async function getDb(): Promise<Db> {
  if (mockDbInstance) {
    return mockDbInstance;
  }

  const { dbName } = getMongoConfig();
  const mongoClient = await getMongoClient();
  return mongoClient.db(dbName);
}

/**
 * Typed collections helper.
 */
export async function getCollections(): Promise<{
  companies: Collection<CompanyProfile>;
  assessments: Collection<Assessment>;
}> {
  const db = await getDb();
  return {
    companies: db.collection<CompanyProfile>("companies"),
    assessments: db.collection<Assessment>("assessments"),
  };
}

/**
 * Tests connection to MongoDB using a ping command with a 5-second timeout.
 */
export async function checkMongoConnection(): Promise<{
  connected: boolean;
  database: string;
  error?: string;
}> {
  const { uri, dbName } = getMongoConfig();

  if (!uri && !mockDbInstance) {
    return {
      connected: false,
      database: dbName,
      error: "MONGODB_URI is not configured",
    };
  }

  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return {
      connected: true,
      database: dbName,
    };
  } catch (err) {
    return {
      connected: false,
      database: dbName,
      error: sanitizeError(err),
    };
  }
}

/**
 * Gracefully closes the database connection.
 */
export async function closeMongoConnection(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    clientPromise = null;
  }
}
