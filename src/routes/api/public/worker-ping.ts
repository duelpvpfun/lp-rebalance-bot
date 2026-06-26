import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/worker-ping")({
  server: {
    handlers: {
      GET: async () => {
        const base = (process.env.WORKER_BASE_URL || "")
          .trim()
          .replace(/\/+$/, "");
        try {
          const r = await fetch(`${base}/health`);
          const body = await r.text();
          return new Response(
            JSON.stringify({ ok: true, base, status: r.status, body }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (e) {
          return new Response(
            JSON.stringify({
              ok: false,
              base,
              error:
                e instanceof Error ? `${e.name}: ${e.message}` : String(e),
            }),
            { status: 502, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
