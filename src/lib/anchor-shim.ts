// Workaround: workerd ESM loader fails to expose `BN` from anchor's index.
// Re-export everything from anchor's browser ESM, and re-bind BN from bn.js.
// Uses absolute node_modules path to bypass our own alias for @coral-xyz/anchor.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export * from "../../node_modules/@coral-xyz/anchor/dist/browser/index.js";
import BNDefault from "bn.js";
export const BN = BNDefault as unknown as typeof BNDefault;
