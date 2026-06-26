import { createFileRoute } from "@tanstack/react-router";
import { cycleStatus } from "@/lib/cycle.server";

/**
 * Disabled legacy trigger. Keeping the route prevents stale external cron jobs
 * from 404-looping, but it can no longer sign transactions.
 */
export const Route = createFileRoute("/api/public/run-cycle")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await cycleStatus();
          return Response.json({ ...result, disabled: true }, { status: 200 });
        } catch (e) {
          return Response.json({ ran: false, disabled: true, error: (e as Error).message }, { status: 500 });
        }
      },
      GET: async () =>
        new Response("Legacy run-cycle trigger disabled. The live timer uses /api/public/tick.", { status: 200 }),
    },
  },
});
