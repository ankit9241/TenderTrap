import { createFileRoute } from "@tanstack/react-router";
import { checkMongoConnection } from "@/lib/server/db";

export const Route = createFileRoute("/api/health/db")({
  server: {
    handlers: {
      GET: async () => {
        const result = await checkMongoConnection();
        const timestamp = new Date().toISOString();

        if (result.connected) {
          return Response.json(
            {
              status: "connected",
              database: result.database,
              timestamp,
            },
            { status: 200 },
          );
        }

        return Response.json(
          {
            status: "disconnected",
            database: result.database,
            message: result.error ?? "Database unavailable",
            timestamp,
          },
          { status: 503 },
        );
      },
    },
  },
});
