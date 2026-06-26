// Client-side helpers: builds the funding transaction the user signs.
import type { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { loadSplToken, loadWeb3 } from "@/lib/solana-client";

export const WORKER_BASE_PUBLIC =
  "https://stunning-yodel-r74qvrvjq564cqp5-8787.app.github.dev";

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

export async function buildFundingTx(opts: {
  connection: Connection;
  payer: PublicKey | string;
  devWallet: string;
  usdcAmount: number;
  solAmount: number;
  usdcMint: string;
}): Promise<Transaction> {
  const { connection, payer, devWallet, usdcAmount, solAmount, usdcMint } = opts;
  console.log("[buildFundingTx] start", { payer: String(payer), devWallet, usdcAmount, solAmount, usdcMint });

  // Guarantee Buffer is on globalThis before loading spl-token (uses Buffer.from internally).
  if (typeof window !== "undefined") {
    const g = globalThis as any;
    if (!g.Buffer?.from) {
      const mod: any = await import("buffer");
      g.Buffer = mod.Buffer ?? mod.default?.Buffer;
      (window as any).Buffer = g.Buffer;
    }
    console.log("[buildFundingTx] Buffer.from is", typeof (globalThis as any).Buffer?.from);
  }

  let web3: any, splToken: any;
  try {
    [web3, splToken] = await Promise.all([loadWeb3(), loadSplToken()]);
  } catch (e) {
    console.error("[buildFundingTx] module load failed", e);
    throw e;
  }
  const { PublicKey, SystemProgram, Transaction } = web3;
  const {
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction,
    getAssociatedTokenAddressSync,
  } = splToken;

  let payerPk: any, dev: any, mint: any;
  try {
    payerPk = typeof payer === "string" ? new PublicKey(payer) : payer;
    dev = new PublicKey(devWallet);
    mint = new PublicKey(usdcMint);
  } catch (e) {
    console.error("[buildFundingTx] PublicKey ctor failed", e);
    throw e;
  }

  let fromAta: any, toAta: any;
  try {
    fromAta = getAssociatedTokenAddressSync(mint, payerPk);
    toAta = getAssociatedTokenAddressSync(mint, dev);
  } catch (e) {
    console.error("[buildFundingTx] getAssociatedTokenAddressSync failed", e);
    throw e;
  }

  const tx = new Transaction();

  try {
    const toAtaInfo = await connection.getAccountInfo(toAta);
    if (!toAtaInfo) {
      tx.add(createAssociatedTokenAccountInstruction(payerPk, toAta, dev, mint));
    }
  } catch (e) {
    console.error("[buildFundingTx] ata-check/create failed", e);
    throw e;
  }

  const usdcRaw = BigInt(Math.round(usdcAmount * 1_000_000));
  if (usdcRaw > 0n) {
    try {
      tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, payerPk, usdcRaw, 6));
    } catch (e) {
      console.error("[buildFundingTx] transferChecked failed", e);
      throw e;
    }
  }

  const lamports = Math.round(solAmount * 1_000_000_000);
  if (lamports > 0) {
    tx.add(SystemProgram.transfer({ fromPubkey: payerPk, toPubkey: dev, lamports }));
  }

  try {
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
  } catch (e) {
    console.error("[buildFundingTx] getLatestBlockhash failed", e);
    throw e;
  }
  tx.feePayer = payerPk;
  console.log("[buildFundingTx] built, ix count:", tx.instructions.length);
  return tx;
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
