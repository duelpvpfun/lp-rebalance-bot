import { createFileRoute } from "@tanstack/react-router";
import { readCycleStatus } from "@/lib/cycle.server";

/**
 * Status-only endpoint for the website timer.
 *
 * tick() is NEVER triggered from here — neither GET nor POST. The cycle is
 * driven exclusively by the in-process scheduler started in src/start.ts.
 * This prevents website visitors (or external pings) from spamming claims/buys.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-secret",
};

async function status() {
  try {
    const result = await readCycleStatus();
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
