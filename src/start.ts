import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

// Start the auto-LP scheduler as soon as the server boots, so the cycle fires
// every minute on its own — no browser tab or external cron needed. We import
// the server-only cycle module dynamically inside a server guard to keep it out
// of the client bundle. ensureScheduler() is idempotent and the underlying
// tick() is cooldown-gated, so this is safe to trigger more than once.
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
  requestMiddleware: [errorMiddleware],
}));
