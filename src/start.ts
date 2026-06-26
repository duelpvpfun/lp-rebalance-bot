import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// ONLY trigger of tick(): a single in-process scheduler per server isolate.
// The /api/public/tick route is status-only. The DB-backed lease +
// cooldown_until row keep this safe even if multiple isolates each start a
// timer — only one isolate can hold the lease at any given moment, and the
// cooldown is pushed 60s into the future the instant a cycle starts claiming.
if (typeof window === "undefined") {
  import("./lib/cycle.server")
    .then(({ ensureScheduler }) => ensureScheduler())
    .catch((e) => console.error("[scheduler] failed to start:", (e as Error).message));
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
