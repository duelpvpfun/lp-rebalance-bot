import { createServerFn } from "@tanstack/react-start";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

function rpcUrl(): string {
  const helius = process.env.HELIUS_API_KEY;
  if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
  return process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}

// Programs we care about (used as hints, not the sole signal).
const PUMP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const JUPITER_V4 = "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type ParsedTx = {
  meta?: {
    preTokenBalances?: Array<{
      owner?: string;
      mint?: string;
      uiTokenAmount?: { uiAmount?: number | null };
    }> | null;
    postTokenBalances?: Array<{
      owner?: string;
      mint?: string;
      uiTokenAmount?: { uiAmount?: number | null };
    }> | null;
    innerInstructions?: Array<{ instructions?: unknown[] }> | null;
  } | null;
  transaction?: { message?: { instructions?: unknown[] } };
};

function tokenDelta(tx: ParsedTx, owner: string, mint: string): number {
  const pre = (tx.meta?.preTokenBalances ?? []).filter(
    (b) => b.owner === owner && b.mint === mint,
  );
  const post = (tx.meta?.postTokenBalances ?? []).filter(
    (b) => b.owner === owner && b.mint === mint,
  );
  const sum = (arr: typeof pre) =>
    arr.reduce((s, b) => s + (b.uiTokenAmount?.uiAmount ?? 0), 0);
  return sum(post) - sum(pre);
}

/**
 * Classify what the dev wallet actually did by reading on-chain balance
 * deltas — never guess from program IDs alone.
 */
function classify(
  tx: ParsedTx,
  programIds: Set<string>,
  wallet: string,
  mint: string,
): string | null {
  const tokenD = tokenDelta(tx, wallet, mint);
  const usdcD = tokenDelta(tx, wallet, USDC_MINT);

  // LP deposit/withdraw — PumpSwap program touched and BOTH sides moved out (or in for withdraw).
  if (programIds.has(PUMP_AMM)) {
    if (tokenD < 0 && usdcD < 0) return "Add Liquidity";
    if (tokenD > 0 && usdcD > 0) return "Remove Liquidity";
    // PumpSwap buy/sell via the AMM (no Jupiter)
    if (tokenD > 0 && usdcD < 0) return "Buy $LIQUITITTY";
    if (tokenD < 0 && usdcD > 0) return "Sell $LIQUITITTY";
    return "PumpSwap Tx";
  }

  // Creator fee claim — pump.fun program + USDC inflow + no token movement.
  if (programIds.has(PUMP_FUN) && tokenD === 0 && usdcD > 0) {
    return "Claim Creator Rewards";
  }

  // Jupiter swap — direction depends on token delta.
  if (programIds.has(JUPITER_V6) || programIds.has(JUPITER_V4)) {
    if (tokenD > 0) return "Buy $LIQUITITTY";
    if (tokenD < 0) return "Sell $LIQUITITTY";
  }

  // Last-resort: pure token transfer of the mint by the dev wallet.
  if (tokenD < 0 && usdcD === 0) return "Send $LIQUITITTY";
  if (tokenD > 0 && usdcD === 0) return "Receive $LIQUITITTY";

  return null;
}

export type DexStats = {
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  liquidityToken: number | null;
  liquidityUsdc: number | null;
  pairUrl: string | null;
  dex: string | null;
};

export type WalletTx = {
  signature: string;
  blockTime: number | null;
  label: string;
  success: boolean;
};

export type StatsPayload = {
  mint: string;
  devWallet: string;
  dex: DexStats;
  txs: WalletTx[];
  lastCycleAt: number | null; // unix seconds — newest claim/buy/LP tx
  cycleIntervalSec: number;
};

function loadPubkey(): string {
  const pk = process.env.DEV_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error("DEV_WALLET_PRIVATE_KEY missing");
  const kp = pk.trim().startsWith("[")
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pk)))
    : Keypair.fromSecretKey(bs58.decode(pk.trim()));
  return kp.publicKey.toBase58();
}

async function fetchDex(mint: string): Promise<DexStats> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (!r.ok) throw new Error(`${r.status}`);
    const j = (await r.json()) as { pairs?: Array<Record<string, unknown>> };
    const pairs = j.pairs ?? [];
    const pair =
      pairs.find(
        (p) =>
          (p.dexId === "pumpswap" || p.dexId === "pump-swap") &&
          (p.quoteToken as { symbol?: string })?.symbol === "USDC",
      ) ??
      pairs.find((p) => (p.quoteToken as { symbol?: string })?.symbol === "USDC") ??
      pairs[0];
    if (!pair) {
      return { priceUsd: null, marketCapUsd: null, liquidityUsd: null, liquidityToken: null, liquidityUsdc: null, pairUrl: null, dex: null };
    }
    const liq = pair.liquidity as { usd?: number; base?: number; quote?: number } | undefined;
    return {
      priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
      marketCapUsd: (pair.marketCap as number | undefined) ?? (pair.fdv as number | undefined) ?? null,
      liquidityUsd: liq?.usd ?? null,
      liquidityToken: liq?.base ?? null,
      liquidityUsdc: liq?.quote ?? null,
      pairUrl: (pair.url as string | undefined) ?? null,
      dex: (pair.dexId as string | undefined) ?? null,
    };
  } catch {
    return { priceUsd: null, marketCapUsd: null, liquidityUsd: null, liquidityToken: null, liquidityUsdc: null, pairUrl: null, dex: null };
  }
}

async function fetchTxs(conn: Connection, wallet: string, mint: string): Promise<WalletTx[]> {
  const sigs = await conn.getSignaturesForAddress(new PublicKey(wallet), { limit: 40 });
  const parsed = await Promise.all(
    sigs.map((s) =>
      conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null),
    ),
  );
  const out: WalletTx[] = [];
  for (let i = 0; i < sigs.length; i++) {
    const s = sigs[i];
    const tx = parsed[i] as ParsedTx | null;
    if (!tx) continue;
    const pids = new Set<string>();
    for (const ix of tx.transaction?.message?.instructions ?? []) {
      const pid = (ix as { programId?: PublicKey }).programId?.toBase58();
      if (pid) pids.add(pid);
    }
    for (const inner of tx.meta?.innerInstructions ?? []) {
      for (const ix of inner.instructions ?? []) {
        const pid = (ix as { programId?: PublicKey }).programId?.toBase58();
        if (pid) pids.add(pid);
      }
    }
    const label = classify(tx, pids, wallet, mint);
    if (!label) continue;
    out.push({
      signature: s.signature,
      blockTime: s.blockTime ?? null,
      label,
      success: !s.err,
    });
    if (out.length >= 20) break;
  }
  return out;
}

export const getStats = createServerFn({ method: "GET" }).handler(async (): Promise<StatsPayload> => {
  const mint = process.env.TOKEN_MINT_ADDRESS;
  if (!mint) throw new Error("TOKEN_MINT_ADDRESS missing");
  const devWallet = loadPubkey();
  const conn = new Connection(rpcUrl(), "confirmed");
  const [dex, txs] = await Promise.all([fetchDex(mint), fetchTxs(conn, devWallet, mint)]);
  const lastCycleAt = txs.find((t) => t.success)?.blockTime ?? null;
  return { mint, devWallet, dex, txs, lastCycleAt, cycleIntervalSec: 60 };
});
