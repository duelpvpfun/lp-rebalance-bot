import { createFileRoute } from "@tanstack/react-router";
import { runCycle } from "@/lib/cycle.server";

/**
 * Manual / cron trigger for the auto-LP cycle. This is the only route allowed
 * to execute a cycle, and it requires Bearer CRON_SECRET plus BOT_ENABLED=true.
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
