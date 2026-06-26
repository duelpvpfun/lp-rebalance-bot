import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";

// Some @solana/* v2 packages only declare `browser`/`node` export conditions
// (no `workerd`/`default`). On the workerd/server build we alias them to their
// browser ESM bundle. On the client build we leave them alone so nested
// node_modules resolution picks the correct version per importer (v2 for the
// spl-token chain, v6 for the kit chain).
const solanaPkgsNeedingWorkerdAlias = [
  "codecs",
  "codecs-data-structures",
  "codecs-strings",
  "options",
];
const workerdSolanaAliases: Record<string, string> = Object.fromEntries(
  solanaPkgsNeedingWorkerdAlias.map((p) => [
    `@solana/${p}`,
    path.resolve(__dirname, `node_modules/@solana/${p}/dist/index.browser.mjs`),
  ]),
);

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
    environments: {
      server: {
        resolve: {
          alias: { ...sharedAlias, ...workerdSolanaAliases },
        } as never,
      },
    },
  },
});
