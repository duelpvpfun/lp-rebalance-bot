import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";
import type { Plugin } from "vite";

// Some @solana/* v2 packages only declare `browser`/`node` export conditions
// (no `workerd`/`default`). The workerd/server build can't pick a file and
// errors out. Resolve them to their browser ESM bundle ONLY for non-client
// environments. The client build keeps natural nested-node_modules resolution
// so the kit chain finds its v6 codecs/errors while the spl-token chain still
// gets v2.
const V2_BROWSER_FALLBACK = [
  "codecs",
  "codecs-data-structures",
  "codecs-strings",
  "options",
];

function solanaServerAliasPlugin(): Plugin {
  const map = new Map(
    V2_BROWSER_FALLBACK.map((p) => [
      `@solana/${p}`,
      path.resolve(__dirname, `node_modules/@solana/${p}/dist/index.browser.mjs`),
    ]),
  );
  return {
    name: "solana-server-alias",
    enforce: "pre",
    resolveId(source) {
      if (this.environment?.name === "client") return null;
      const hit = map.get(source);
      return hit ?? null;
    },
  };
}

const sharedAlias = {
  "rpc-websockets/dist/lib/client": path.resolve(__dirname, "src/lib/rpc-websockets-stub.ts"),
  "rpc-websockets/dist/lib/client/websocket.browser": path.resolve(__dirname, "src/lib/rpc-websockets-stub.ts"),
  "rpc-websockets": path.resolve(__dirname, "src/lib/rpc-websockets-stub.ts"),
  "@coral-xyz/anchor": path.resolve(__dirname, "src/lib/anchor-shim.ts"),
};

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [solanaServerAliasPlugin()],
    resolve: {
      alias: { ...sharedAlias },
    },
    ssr: {
      noExternal: [
        "@coral-xyz/anchor",
        "@pump-fun/pump-sdk",
        "@pump-fun/pump-swap-sdk",
        "@pump-fun/agent-payments-sdk",
        /^@solana\/(?!buffer-layout)/,
      ],
    },
  },
});
