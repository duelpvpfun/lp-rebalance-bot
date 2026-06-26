import { createServerFn } from "@tanstack/react-start";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  OnlinePumpAmmSdk,
  canonicalPumpPoolPda,
  poolPda,
  lpMintPda,
} from "@pump-fun/pump-swap-sdk";
import { PumpSdk, bondingCurvePda } from "@pump-fun/pump-sdk";

const OWN_POOL_INDEX = Number(process.env.LP_POOL_INDEX ?? "1");

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

const CYCLE_LABEL_ORDER = {
  "Claim USDC Creator Rewards": 1,
  "Swap 35% USDC → $LIQUITITTY": 2,
  "Add TOKEN + USDC to LP": 3,
  "Burn LP Tokens": 4,
} as const;

type CycleLabel = keyof typeof CYCLE_LABEL_ORDER;

function tokenDelta(tx: ParsedTx, owner: string, mint: string): number {
  const pre = (tx.meta?.preTokenBalances ?? []).filter((b) => b.owner === owner && b.mint === mint);
  const post = (tx.meta?.postTokenBalances ?? []).filter(
    (b) => b.owner === owner && b.mint === mint,
  );
  const sum = (arr: typeof pre) => arr.reduce((s, b) => s + (b.uiTokenAmount?.uiAmount ?? 0), 0);
  return sum(post) - sum(pre);
}

/**
 * Only surface the three real cycle events, and only when they actually moved
 * funds on-chain. Zero-delta calls (e.g. "No creator fee to collect") are
 * hidden — they're noise, not activity.
 */
function classify(
  tx: ParsedTx,
  programIds: Set<string>,
  wallet: string,
  mint: string,
  lpMint: string,
): CycleLabel | null {
  const tokenD = tokenDelta(tx, wallet, mint);
  const usdcD = tokenDelta(tx, wallet, USDC_MINT);
  const lpD = tokenDelta(tx, wallet, lpMint);
  const dust = 0.0000001;

  const touchesPump = programIds.has(PUMP_FUN) || programIds.has(PUMP_AMM);
  const touchesJup = programIds.has(JUPITER_V6) || programIds.has(JUPITER_V4);

  // 4) Burn LP — LP token balance drops after deposit, locking liquidity.
  if (lpD < -dust) return "Burn LP Tokens";

  // 1) Claim Creator Rewards — USDC comes in with no token movement.
  if (touchesPump && usdcD > dust && Math.abs(tokenD) <= dust) {
    return "Claim USDC Creator Rewards";
  }

  // 2) Swap/buyback — USDC leaves and $LIQUITITTY enters the dev wallet.
  if ((touchesJup || touchesPump) && tokenD > dust && usdcD < -dust) {
    return "Swap 35% USDC → $LIQUITITTY";
  }

  // 3) Add Liquidity — token + USDC leave wallet through PumpSwap and LP is minted.
  if (programIds.has(PUMP_AMM) && tokenD < -dust && usdcD < -dust) {
    return "Add TOKEN + USDC to LP";
  }

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
  label: CycleLabel;
  success: boolean;
};

function orderCycleTxs(txs: WalletTx[]): WalletTx[] {
  const oldestFirst = [...txs].sort((a, b) => {
    const timeA = a.blockTime ?? 0;
    const timeB = b.blockTime ?? 0;
    if (timeA !== timeB) return timeA - timeB;
    return CYCLE_LABEL_ORDER[a.label] - CYCLE_LABEL_ORDER[b.label];
  });

  const groups: WalletTx[][] = [];
  let current: WalletTx[] = [];
  let expected = 1;

  for (const tx of oldestFirst) {
    const order = CYCLE_LABEL_ORDER[tx.label];
    if (order === 1) {
      if (current.length === 4) groups.push(current);
      current = [tx];
      expected = 2;
      continue;
    }
    if (current.length > 0 && order === expected) {
      current.push(tx);
      expected += 1;
      if (current.length === 4) {
        groups.push(current);
        current = [];
        expected = 1;
      }
    }
  }

  // Flatten complete cycles and show newest transaction first, oldest last.
  return groups
    .flatMap((group) => group)
    .sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0))
    .slice(0, 20);
}

export type StatsPayload = {
  mint: string;
  devWallet: string;
  dex: DexStats;
  txs: WalletTx[];
  lastCycleAt: number | null; // unix seconds — newest claim/buy/LP tx
  cycleIntervalSec: number;
  cycleRuntime: {
    phase: "claim" | "buy" | "lp" | "burn" | "idle";
    cycleStartAt: number | null;
    cooldownUntil: number | null;
  };
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
    // Sum liquidity across EVERY pool for this token.
    let sumUsd = 0;
    let sumToken = 0;
    let sumUsdc = 0;
    let any = false;
    for (const p of pairs) {
      const liq = p.liquidity as { usd?: number; base?: number; quote?: number } | undefined;
      const quoteSym = (p.quoteToken as { symbol?: string })?.symbol;
      if (liq?.usd) { sumUsd += liq.usd; any = true; }
      if (liq?.base) sumToken += liq.base;
      if (liq?.quote && quoteSym === "USDC") sumUsdc += liq.quote;
    }
    const pair =
      pairs.find(
        (p) =>
          (p.dexId === "pumpswap" || p.dexId === "pump-swap") &&
          (p.quoteToken as { symbol?: string })?.symbol === "USDC",
      ) ??
      pairs.find((p) => (p.quoteToken as { symbol?: string })?.symbol === "USDC") ??
      pairs[0];
    if (!pair) {
      return {
        priceUsd: null, marketCapUsd: null, liquidityUsd: null,
        liquidityToken: null, liquidityUsdc: null, pairUrl: null, dex: null,
      };
    }
    return {
      priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
      marketCapUsd:
        (pair.marketCap as number | undefined) ?? (pair.fdv as number | undefined) ?? null,
      liquidityUsd: any ? sumUsd : null,
      liquidityToken: sumToken || null,
      liquidityUsdc: sumUsdc || null,
      pairUrl: (pair.url as string | undefined) ?? null,
      dex: (pair.dexId as string | undefined) ?? null,
    };
  } catch {
    return {
      priceUsd: null, marketCapUsd: null, liquidityUsd: null,
      liquidityToken: null, liquidityUsdc: null, pairUrl: null, dex: null,
    };
  }
}

const TOKEN_SUPPLY_FALLBACK = 1_000_000_000;

async function readPoolReserves(
  conn: Connection,
  mint: string,
  poolPk: PublicKey,
): Promise<Partial<DexStats> | null> {
  try {
    const mintPk = new PublicKey(mint);
    const sdk = new OnlinePumpAmmSdk(conn);
    const pool = await sdk.fetchPool(poolPk);
    const [baseBal, quoteBal, tokenSupply] = await Promise.all([
      conn.getTokenAccountBalance(pool.poolBaseTokenAccount).catch(() => null),
      conn.getTokenAccountBalance(pool.poolQuoteTokenAccount).catch(() => null),
      conn.getTokenSupply(mintPk).catch(() => null),
    ]);
    const liquidityToken = baseBal?.value.uiAmount ?? null;
    const liquidityUsdc = quoteBal?.value.uiAmount ?? null;
    if (liquidityToken == null || liquidityUsdc == null || liquidityToken <= 0) return null;
    const priceUsd = liquidityUsdc / liquidityToken;
    const liquidityUsd = liquidityUsdc * 2;
    const supply = tokenSupply?.value.uiAmount ?? TOKEN_SUPPLY_FALLBACK;
    const marketCapUsd = priceUsd * supply;
    return { priceUsd, marketCapUsd, liquidityUsd, liquidityToken, liquidityUsdc };
  } catch {
    return null;
  }
}

async function fetchOnchainPool(conn: Connection, mint: string): Promise<Partial<DexStats>> {
  const mintPk = new PublicKey(mint);
  const usdcPk = new PublicKey(USDC_MINT);
  const devWallet = loadPubkey();

  // Sum BOTH known pools (our own + canonical) for total liquidity.
  const [own, canonical] = await Promise.all([
    readPoolReserves(conn, mint, poolPda(OWN_POOL_INDEX, new PublicKey(devWallet), mintPk, usdcPk)),
    readPoolReserves(conn, mint, canonicalPumpPoolPda(mintPk, usdcPk)),
  ]);
  const pools = [own, canonical].filter((p): p is Partial<DexStats> => !!p);
  if (pools.length > 0) {
    const sum = (k: keyof DexStats) =>
      pools.reduce((s, p) => s + ((p[k] as number | null | undefined) ?? 0), 0);
    return {
      priceUsd: pools[0].priceUsd ?? null,
      marketCapUsd: pools[0].marketCapUsd ?? null,
      liquidityUsd: sum("liquidityUsd"),
      liquidityToken: sum("liquidityToken"),
      liquidityUsdc: sum("liquidityUsdc"),
    };
  }

  // Pre-graduation: bonding curve.
  return fetchBondingCurveStats(conn, mint);
}

/**
 * Pre-graduation liquidity comes from the bonding curve, not an LP pool. We
 * read the curve's reserves so the stats boxes populate while the token is
 * still on pump.fun (before it shows up on DexScreener / PumpSwap).
 */
async function fetchBondingCurveStats(conn: Connection, mint: string): Promise<Partial<DexStats>> {
  try {
    const mintPk = new PublicKey(mint);
    const sdk = new PumpSdk();
    const bcInfo = await conn.getAccountInfo(bondingCurvePda(mintPk));
    if (!bcInfo) return {};
    const bc = sdk.decodeBondingCurveNullable(bcInfo);
    if (!bc || bc.complete) return {};

    const [tokenSupply, mintDecimals] = await Promise.all([
      conn.getTokenSupply(mintPk).catch(() => null),
      conn
        .getTokenSupply(mintPk)
        .then((r) => r.value.decimals)
        .catch(() => 6),
    ]);

    const usdcDecimals = 6;
    // Reserves currently held by the curve.
    const realToken = Number(bc.realTokenReserves.toString()) / 10 ** mintDecimals;
    const realUsdc = Number(bc.realQuoteReserves.toString()) / 10 ** usdcDecimals;
    // Spot price from virtual reserves (USDC per token).
    const vToken = Number(bc.virtualTokenReserves.toString()) / 10 ** mintDecimals;
    const vUsdc = Number(bc.virtualQuoteReserves.toString()) / 10 ** usdcDecimals;
    if (vToken <= 0) return {};
    const priceUsd = vUsdc / vToken;

    const supply = tokenSupply?.value.uiAmount ?? TOKEN_SUPPLY_FALLBACK;
    const marketCapUsd = priceUsd * supply;

    return {
      priceUsd,
      marketCapUsd,
      liquidityUsd: realUsdc * 2,
      liquidityToken: realToken,
      liquidityUsdc: realUsdc,
    };
  } catch {
    return {};
  }
}

async function fetchTxs(conn: Connection, wallet: string, mint: string): Promise<WalletTx[]> {
  const lpMint = lpMintPda(
    poolPda(OWN_POOL_INDEX, new PublicKey(wallet), new PublicKey(mint), new PublicKey(USDC_MINT)),
  ).toBase58();
  const sigs = await conn.getSignaturesForAddress(new PublicKey(wallet), { limit: 40 });
  const parsed = await Promise.all(
    sigs.map((s) =>
      conn
        .getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
        .catch(() => null),
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
    const label = classify(tx, pids, wallet, mint, lpMint);
    if (!label) continue;
    out.push({
      signature: s.signature,
      blockTime: s.blockTime ?? null,
      label,
      success: !s.err,
    });
  }
  return orderCycleTxs(out);
}

async function fetchCycleRuntime(): Promise<StatsPayload["cycleRuntime"]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("cycle_runtime_state")
      .select("phase, cycle_start_at, cooldown_until")
      .eq("id", "liquititty-auto-lp")
      .maybeSingle();
    if (error || !data) throw error ?? new Error("no runtime row");
    const cycleStartAt = data.cycle_start_at ? Math.floor(Date.parse(data.cycle_start_at) / 1000) : null;
    const cooldownUntil = data.cooldown_until ? Math.floor(Date.parse(data.cooldown_until) / 1000) : null;
    return {
      phase: cycleStartAt ? (data.phase as "claim" | "buy" | "lp" | "burn") : "idle",
      cycleStartAt,
      cooldownUntil,
    };
  } catch {
    return { phase: "idle", cycleStartAt: null, cooldownUntil: null };
  }
}

export const getStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<StatsPayload> => {
    const mint = process.env.TOKEN_MINT_ADDRESS;
    if (!mint) throw new Error("TOKEN_MINT_ADDRESS missing");
    const devWallet = loadPubkey();
    const conn = new Connection(rpcUrl(), "confirmed");
    const [dexRaw, onchain, txs, cycleRuntime] = await Promise.all([
      fetchDex(mint),
      fetchOnchainPool(conn, mint),
      fetchTxs(conn, devWallet, mint),
      fetchCycleRuntime(),
    ]);

    // Prefer live on-chain pool reserves; fall back to DexScreener per-field so a
    // value always shows as long as either source has it.
    const dex: DexStats = {
      priceUsd: onchain.priceUsd ?? dexRaw.priceUsd,
      marketCapUsd: onchain.marketCapUsd ?? dexRaw.marketCapUsd,
      liquidityUsd: onchain.liquidityUsd ?? dexRaw.liquidityUsd,
      liquidityToken: onchain.liquidityToken ?? dexRaw.liquidityToken,
      liquidityUsdc: onchain.liquidityUsdc ?? dexRaw.liquidityUsdc,
      pairUrl: dexRaw.pairUrl,
      dex: dexRaw.dex ?? (onchain.liquidityUsd != null ? "pumpswap" : null),
    };

    const lastCycleAt = txs.find((t) => t.success)?.blockTime ?? null;
    return { mint, devWallet, dex, txs, lastCycleAt, cycleIntervalSec: 60, cycleRuntime };
  },
);
