// Client-side launch helpers. The funding transaction is built on our worker
// (server has reliable Buffer + spl-token); the browser only deserializes,
// signs, and sends it.

export const WORKER_BASE_PUBLIC =
  "https://liquititty-worker-production.up.railway.app";

export type PrepareResult = {
  pendingId: string;
  devWallet: string;
  fund: { usdc: number; sol: number; usdcMint: string };
  expiresAt?: number;
};

export type LaunchStatus = {
  status: "awaiting_funds" | "funded" | "executing" | "launched" | "failed" | string;
  mint?: string;
  error?: string;
  [k: string]: unknown;
};

export type FundingTxResponse = {
  transaction: string; // base64
  usdcMint?: string;
};

export async function fetchFundingTx(input: {
  payer: string;
  devWallet: string;
  usdc: number;
  sol: number;
}): Promise<FundingTxResponse> {
  const r = await fetch("/api/public/launch/funding-tx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(
      `funding-tx failed (${r.status}): ${text || "no response body"}`,
    );
  }
  try {
    return JSON.parse(text) as FundingTxResponse;
  } catch {
    throw new Error(`funding-tx returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 48);
}
