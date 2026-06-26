import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/launch/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const base = process.env.WORKER_BASE_URL;
        const secret = process.env.LAUNCH_HTTP_SECRET;
        if (!base || !secret) {
          return new Response(
            JSON.stringify({ error: "Worker not configured" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) {
          return new Response(JSON.stringify({ error: "id required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const res = await fetch(
          `${base}/launch/status?id=${encodeURIComponent(id)}`,
          { headers: { authorization: `Bearer ${secret}` } },
        );
        const text = await res.text();
        return new Response(text, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
