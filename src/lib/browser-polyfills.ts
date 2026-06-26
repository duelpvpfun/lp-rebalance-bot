import bufferModule from "buffer/";

const { Buffer } = bufferModule;

const globalScope = globalThis as typeof globalThis & { Buffer?: unknown };

if (!globalScope.Buffer) {
  globalScope.Buffer = Buffer;
}