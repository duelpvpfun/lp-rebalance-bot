import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/foo")({
  server: {
    handlers: {
      GET: async () => new Response("hi", { status: 200 }),
    },
  },
});
