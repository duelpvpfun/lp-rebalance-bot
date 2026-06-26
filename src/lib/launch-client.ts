// Client-side helpers: builds the funding transaction the user signs.
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

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
  payer: PublicKey;
  devWallet: string;
  usdcAmount: number;
  solAmount: number;
  usdcMint: string;
}): Promise<Transaction> {
  const { connection, payer, devWallet, usdcAmount, solAmount, usdcMint } = opts;
  const dev = new PublicKey(devWallet);
  const mint = new PublicKey(usdcMint);

  const fromAta = getAssociatedTokenAddressSync(mint, payer);
  const toAta = getAssociatedTokenAddressSync(mint, dev);

  const tx = new Transaction();

  // Create destination ATA only if it doesn't already exist.
  const toAtaInfo = await connection.getAccountInfo(toAta);
  if (!toAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(payer, toAta, dev, mint),
    );
  }

  // USDC has 6 decimals.
  const usdcRaw = BigInt(Math.round(usdcAmount * 1_000_000));
  if (usdcRaw > 0n) {
    tx.add(
      createTransferCheckedInstruction(
        fromAta,
        mint,
        toAta,
        payer,
        usdcRaw,
        6,
      ),
    );
  }

  const lamports = Math.round(solAmount * 1_000_000_000);
  if (lamports > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: dev,
        lamports,
      }),
    );
  }

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
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
