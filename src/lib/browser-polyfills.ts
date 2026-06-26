import * as bufferModule from "buffer";

const BufferCtor =
  (bufferModule as { Buffer?: typeof globalThis.Buffer }).Buffer ??
  (bufferModule as { default?: { Buffer?: typeof globalThis.Buffer } }).default?.Buffer;

const globalScope = globalThis as any;

if (!globalScope.Buffer && BufferCtor) {
  globalScope.Buffer = BufferCtor;
}