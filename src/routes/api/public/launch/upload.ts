import { createFileRoute } from "@tanstack/react-router";

// Proxies image + metadata upload to pump.fun's public IPFS endpoint and
// returns the metadata URI the worker needs.
export const Route = createFileRoute("/api/launch/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const incoming = await request.formData();
          const fd = new FormData();
          const file = incoming.get("file");
          if (!(file instanceof File)) {
            return new Response(JSON.stringify({ error: "file required" }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }
          fd.append("file", file, file.name || "image.png");
          for (const k of ["name", "symbol", "description", "twitter", "telegram", "website"]) {
            const v = incoming.get(k);
            if (typeof v === "string") fd.append(k, v);
          }
          fd.append("showName", "true");

          const res = await fetch("https://pump.fun/api/ipfs", {
            method: "POST",
            body: fd,
          });
          const text = await res.text();
          if (!res.ok) {
            return new Response(
              JSON.stringify({ error: "ipfs upload failed", detail: text }),
              { status: 502, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(text, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (e: any) {
          return new Response(
            JSON.stringify({ error: e?.message ?? "upload error" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
