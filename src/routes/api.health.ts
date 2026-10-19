import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response(
            JSON.stringify({
              error: "Method Not Allowed",
              message: "Health check only supports GET",
            }),
            {
              status: 405,
              headers: {
                "Content-Type": "application/json",
                Allow: "GET, HEAD",
              },
            },
          );
        }

        return new Response(
          JSON.stringify({
            status: "ok",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            service: "TenderTrap",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store, no-cache, must-revalidate",
            },
          },
        );
      },
    },
  },
});
