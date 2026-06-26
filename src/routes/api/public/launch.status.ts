import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/launch/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const base = (process.env.WORKER_BASE_URL || "")
            .trim()
            .replace(/\/+$/, "");
          const secret = (process.env.LAUNCH_HTTP_SECRET || "").trim();
          if (!base || !secret) {
            return new Response(
              JSON.stringify({
                error:
                  "Worker not configured (missing WORKER_BASE_URL or LAUNCH_HTTP_SECRET)",
              }),
              {
                status: 500,
                headers: { "content-type": "application/json" },
              },
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
        } catch (e) {
          return new Response(
            JSON.stringify({ error: "proxy_failed", detail: String(e) }),
            { status: 502, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
