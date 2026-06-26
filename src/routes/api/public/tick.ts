import { createFileRoute } from "@tanstack/react-router";
import { cycleStatus } from "@/lib/cycle.server";

/**
 * Status-only endpoint for the website timer.
 *
 * tick() is NEVER triggered from here — neither GET nor POST. This endpoint is
 * read-only so website visitors (or external pings) cannot spam claims/buys.
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

export const Route = createFileRoute("/api/public/tick")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => status(),
      POST: async () => status(),
    },
  },
});
