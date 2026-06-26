// Re-export everything from anchor's browser ESM, but force BN to be a
// resolved default import from bn.js. Workerd's ESM loader otherwise fails
// to expose the `BN` re-export from anchor's index.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export * from "@coral-xyz/anchor/dist/browser/index.js";
import BNDefault from "bn.js";
export const BN = BNDefault as unknown as typeof BNDefault;
