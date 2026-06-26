// Keep this file lightweight during SSR. Solana browser dependencies are loaded
// lazily through `solana-client.ts`, which installs Buffer before importing them.
export {};