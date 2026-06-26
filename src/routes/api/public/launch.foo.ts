import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/launch/foo")({
  server: {
    handlers: {
      GET: async () => new Response("hi", { status: 200 }),
    },
  },
});
