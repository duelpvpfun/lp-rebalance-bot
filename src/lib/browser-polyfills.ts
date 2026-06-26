import bufferModule from "buffer";

const Buffer = (bufferModule as { Buffer?: typeof globalThis.Buffer }).Buffer;

const globalScope = globalThis as any;

if (!globalScope.Buffer && Buffer) {
  globalScope.Buffer = Buffer;
}