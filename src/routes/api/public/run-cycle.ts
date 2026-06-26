import { createFileRoute } from "@tanstack/react-router";
import { runCycle } from "@/lib/cycle.server";

/**
 * Manual / cron trigger for the auto-LP cycle.
 * The website also runs the cycle automatically via /api/public/tick,
 * so this endpoint is only needed for manual kicks.
 */
export const Route = createFileRoute("/api/public/run-cycle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
        if (!process.env.CRON_SECRET || auth !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await runCycle();
          return Response.json(result, { status: result.ok ? 200 : 500 });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
      GET: async () =>
        new Response("POST with Bearer CRON_SECRET to run the auto-LP cycle.", { status: 200 }),
    },
  },
});
