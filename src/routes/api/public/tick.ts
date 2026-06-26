import { createFileRoute } from "@tanstack/react-router";
import { tick } from "@/lib/cycle.server";

/**
 * Built-in scheduler. The website polls this endpoint; the handler runs
 * the cycle if and only if 5 minutes have elapsed since the last on-chain
 * action by the dev wallet. No external cron needed.
 *
 * Safe to call from anywhere — the heavy work is gated by an on-chain
 * timestamp + an in-memory single-flight lock. Spammers just get a
 * "cooldown" no-op.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export const Route = createFileRoute("/api/public/tick")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
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
      POST: async () => {
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
