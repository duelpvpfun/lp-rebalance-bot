import bufferModule from "buffer/";

const { Buffer } = bufferModule;

const globalScope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };

if (!globalScope.Buffer) {
  globalScope.Buffer = Buffer;
}