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

function isAuthorizedCron(request: Request): boolean {
  const provided = request.headers.get("x-cron-secret");
  if (!provided) return false;
  const secret = process.env.CRON_SECRET;
  return !!secret && provided === secret;
}

async function isAuthorizedCronRequest(request: Request): Promise<boolean> {
  if (isAuthorizedCron(request)) return true;

  const provided = request.headers.get("x-cron-secret");
  if (!provided) return false;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("bot_runtime_secrets")
      .select("secret")
      .eq("key", "pg_cron_tick")
      .maybeSingle();
    return typeof data?.secret === "string" && data.secret.length > 0 && data.secret === provided;
  } catch {
    return false;
  }
}

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
        if (!(await isAuthorizedCronRequest(request))) {
          return Response.json(
            { ran: false, blocked: true, reason: "cron_secret_missing_or_invalid" },
            { status: 403, headers: CORS },
          );
        }
        return advance();
      },
    },
  },
});
