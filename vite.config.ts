import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";

// @solana/* packages only declare `browser`/`node` export conditions, with no
// `workerd`/`worker`/`default` fallback. Rolldown's worker build can't pick a
// file and errors out. Alias each to its browser ESM bundle.
const solanaPkgs = [
  "codecs",
  "codecs-core",
  "codecs-data-structures",
  "codecs-numbers",
  "codecs-strings",
  "options",
];
const solanaAliases: Record<string, string> = Object.fromEntries(
  solanaPkgs.map((p) => [
    `@solana/${p}`,
    path.resolve(__dirname, `node_modules/@solana/${p}/dist/index.browser.mjs`),
  ]),
);
// @solana/errors is depended on at v2 (codecs/options) and v6 (kit chain).
// Force the v6 superset everywhere — newer constants are additive, so v2
// consumers still find what they need.
solanaAliases["@solana/errors"] = path.resolve(
  __dirname,
  "node_modules/@solana/kit/node_modules/@solana/errors/dist/index.browser.mjs",
);

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: {
        "rpc-websockets/dist/lib/client": path.resolve(__dirname, "src/lib/rpc-websockets-stub.ts"),
        "rpc-websockets/dist/lib/client/websocket.browser": path.resolve(__dirname, "src/lib/rpc-websockets-stub.ts"),
        "rpc-websockets": path.resolve(__dirname, "src/lib/rpc-websockets-stub.ts"),
        "@coral-xyz/anchor": path.resolve(__dirname, "src/lib/anchor-shim.ts"),
        ...solanaAliases,
      },
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
