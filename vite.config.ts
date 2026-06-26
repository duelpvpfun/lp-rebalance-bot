import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "node:path";
import fs from "node:fs";
import type { Plugin } from "vite";

// Some @solana/* v2 packages only declare `browser`/`node` export conditions
// (no `workerd`/`default`), and the workerd build can't pick a file. The v6
// kit chain DOES declare `workerd` and must resolve to its own nested copies.
// We walk node_modules from the importer up; if the nearest copy of the
// requested package is a v2 (no workerd export), we redirect to the v2
// browser ESM bundle. v6 packages are left to natural resolution.
const SOLANA_PKGS = new Set([
  "codecs",
  "codecs-core",
  "codecs-data-structures",
  "codecs-numbers",
  "codecs-strings",
  "errors",
  "options",
]);

function findNearestPkg(fromDir: string, pkgName: string): string | null {
  let dir = fromDir;
  // walk up until filesystem root
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, "node_modules", pkgName);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function solanaServerAliasPlugin(): Plugin {
  return {
    name: "solana-workerd-v2-fallback",
    enforce: "pre",
    resolveId(source, importer) {
      if (this.environment?.name === "client") return null;
      if (!source.startsWith("@solana/")) return null;
      const sub = source.slice("@solana/".length);
      if (!SOLANA_PKGS.has(sub)) return null;
      const fromDir = importer ? path.dirname(importer) : __dirname;
      const pkgDir = findNearestPkg(fromDir, source) ?? path.join(__dirname, "node_modules", source);
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
        const exp = pj.exports;
        const root = exp && typeof exp === "object" ? exp["."] ?? exp : null;
        const hasWorkerd = root && typeof root === "object" && ("workerd" in root || "default" in root);
        if (hasWorkerd) return null; // resolver can pick a file itself
        const browserMjs = path.join(pkgDir, "dist/index.browser.mjs");
        if (fs.existsSync(browserMjs)) return browserMjs;
      } catch {
        /* ignore */
      }
      return null;
    },
  };
}

function browserNodePolyfills(): Plugin[] {
  return nodePolyfills({
    include: ["buffer", "process"],
    globals: { Buffer: true, global: true, process: true },
    protocolImports: true,
  }).map((plugin) => ({
    ...plugin,
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
  }));
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
    plugins: [
      solanaServerAliasPlugin(),
      ...browserNodePolyfills(),
    ],
    define: {
      global: "globalThis",
    },
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
    optimizeDeps: {
      include: ["buffer"],
    },
  },

});
