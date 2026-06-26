import bufferModule from "buffer/";

const { Buffer } = bufferModule;

const globalScope = globalThis as any;

if (!globalScope.Buffer) {
  globalScope.Buffer = Buffer;
}