import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";

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
      },
    },
  },
});
