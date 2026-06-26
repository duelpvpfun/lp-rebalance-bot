import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/launch/broadcast")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const base = process.env.WORKER_BASE_URL;
        const secret = process.env.LAUNCH_HTTP_SECRET;
        if (!base || !secret) {
          return new Response(
            JSON.stringify({ error: "Worker not configured" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        const body = await request.text();
        const res = await fetch(`${base}/launch/broadcast`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${secret}`,
          },
          body,
        });
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
