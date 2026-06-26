import { Buffer } from "buffer";

const globalScope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };

if (!globalScope.Buffer) {
  globalScope.Buffer = Buffer;
}