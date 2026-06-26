import { Buffer } from "buffer";

export function installBrowserPolyfills() {
  if (typeof globalThis === "undefined") return;

  const globalScope = globalThis as any;
  if (!globalScope.Buffer?.from) {
    globalScope.Buffer = Buffer;
  }

  if (!globalScope.global) {
    globalScope.global = globalScope;
  }

  if (typeof window !== "undefined") {
    const windowScope = window as any;
    if (!windowScope.Buffer?.from) {
      windowScope.Buffer = Buffer;
    }
    if (!windowScope.global) {
      windowScope.global = globalScope;
    }
  }
}

installBrowserPolyfills();

export { Buffer };
