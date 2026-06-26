import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/launch/prepare")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
          const body = await request.text();
          const res = await fetch(`${base}/launch/prepare`, {
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
