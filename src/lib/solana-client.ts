import { installBrowserPolyfills } from "./browser-polyfills";

let bufferPromise: Promise<void> | null = null;
let web3Promise: Promise<typeof import("@solana/web3.js")> | null = null;
let splTokenPromise: Promise<typeof import("@solana/spl-token")> | null = null;

async function ensureBrowserBuffer() {
  if (typeof window === "undefined") return;
  installBrowserPolyfills();
  const globalScope = globalThis as any;
  if (globalScope.Buffer?.from) return;

  bufferPromise ??= import("buffer").then((mod: any) => {
    const BufferCtor = mod.Buffer ?? mod.default?.Buffer;
    if (BufferCtor?.from) {
      globalScope.Buffer = BufferCtor;
      (window as any).Buffer = BufferCtor;
    }
  });
  await bufferPromise;
}

export async function loadWeb3() {
  web3Promise ??= (async () => {
    await ensureBrowserBuffer();
    return import("@solana/web3.js");
  })();
  return web3Promise;
}

export async function loadSplToken() {
  splTokenPromise ??= (async () => {
    await ensureBrowserBuffer();
    return import("@solana/spl-token");
  })();
  return splTokenPromise;
}