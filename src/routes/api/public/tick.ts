import { createFileRoute } from "@tanstack/react-router";
import { cycleStatus, tick } from "@/lib/cycle.server";

/**
 * Timer endpoint.
 *
 * GET is read-only status. POST advances exactly one locked step, and the DB
 * cooldown/lease makes early or duplicate calls no-ops.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-secret",
};

async function status() {
  try {
    const result = await cycleStatus();
    return Response.json(result, { headers: CORS });
  } catch (e) {
    return Response.json(
      { ran: false, error: (e as Error).message },
      { status: 500, headers: CORS },
    );
  }
}

async function advance() {
  try {
    const result = await tick();
    return Response.json(result, { headers: CORS });
  } catch (e) {
    return Response.json(
      { ran: false, error: (e as Error).message },
      { status: 500, headers: CORS },
    );
  }
}

export const Route = createFileRoute("/api/public/tick")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => status(),
      POST: async ({ request }) => {
        const isLiveTimer = request.headers.get("x-liquititty-live-timer") === "1";
        if (!isLiveTimer) {
          return Response.json(
            { ran: false, blocked: true, reason: "timer_header_missing" },
            { status: 403, headers: CORS },
          );
        }
        return advance();
      },
    },
  },
});
