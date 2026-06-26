import { createFileRoute } from "@tanstack/react-router";
import { readCycleStatus, tick } from "@/lib/cycle.server";

/**
 * Cycle endpoint.
 * GET is status-only for the website timer.
 * POST is secret-protected and can advance exactly one cycle step.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
};

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const cronSecret = request.headers.get("x-cron-secret") ?? "";
  return auth === `Bearer ${secret}` || cronSecret === secret;
}

export const Route = createFileRoute("/api/public/tick")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        try {
          const result = await readCycleStatus();
          return Response.json(result, { headers: CORS });
        } catch (e) {
          return Response.json(
            { ran: false, error: (e as Error).message },
            { status: 500, headers: CORS },
          );
        }
      },
      POST: async ({ request }) => {
        if (!isAuthorized(request)) {
          return Response.json({ ran: false, error: "Unauthorized" }, { status: 401, headers: CORS });
        }
        try {
          const result = await tick();
          return Response.json(result, { headers: CORS });
        } catch (e) {
          return Response.json(
            { ran: false, error: (e as Error).message },
            { status: 500, headers: CORS },
          );
        }
      },
    },
  },
});
