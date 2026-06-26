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
  "errors",
  "options",
];
const solanaAliases = Object.fromEntries(
  solanaPkgs.map((p) => [
    `@solana/${p}`,
    path.resolve(__dirname, `node_modules/@solana/${p}/dist/index.browser.mjs`),
  ]),
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
        ...solanaAliases,
      },
    },
  },
});
