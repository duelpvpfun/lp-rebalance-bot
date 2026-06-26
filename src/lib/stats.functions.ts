import { createServerFn } from "@tanstack/react-start";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { OnlinePumpAmmSdk, canonicalPumpPoolPda, poolPda } from "@pump-fun/pump-swap-sdk";
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
 * Only surface the three real cycle events, and only when they actually moved
 * funds on-chain. Zero-delta calls (e.g. "No creator fee to collect") are
 * hidden — they're noise, not activity.
 */
function classify(
  tx: ParsedTx,
  programIds: Set<string>,
  wallet: string,
  mint: string,
): string | null {
  const tokenD = tokenDelta(tx, wallet, mint);
  const usdcD = tokenDelta(tx, wallet, USDC_MINT);

  const touchesPump = programIds.has(PUMP_FUN) || programIds.has(PUMP_AMM);
  const touchesJup = programIds.has(JUPITER_V6) || programIds.has(JUPITER_V4);

  // 1) Claim Creator Rewards — USDC came in, no token movement, pump program
  //    touched (works for both bonding-curve and AMM claims).
  if (touchesPump && usdcD > 0 && tokenD === 0) return "Claim Creator Rewards";

  // 2) Buy $LIQUITITTY — USDC out, token in. Covers bonding-curve buys
  //    (PUMP_FUN), AMM buys (PUMP_AMM) and Jupiter.
  if ((touchesJup || touchesPump) && tokenD > 0 && usdcD < 0) {
    return "Buy $LIQUITITTY";
  }

  // 3) Add Liquidity — both token and USDC leave wallet via PumpSwap (AMM only;
  //    there is no LP add before graduation).
  if (programIds.has(PUMP_AMM) && tokenD < 0 && usdcD < 0) return "Add Liquidity";

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

const TOKEN_SUPPLY_FALLBACK = 1_000_000_000;

/**
 * Read liquidity straight from the canonical PumpSwap pool on-chain. This is
 * the source of truth and works the instant the pool exists — unlike
 * DexScreener, which can take many minutes to index a fresh pump.fun pair
 * (that lag is why the stats boxes were showing "—").
 */
async function readPoolReserves(
  conn: Connection,
  mint: string,
  poolPk: PublicKey,
): Promise<Partial<DexStats> | null> {
  try {
    const mintPk = new PublicKey(mint);
    const sdk = new OnlinePumpAmmSdk(conn);
    const pool = await sdk.fetchPool(poolPk);

    // Base = our token, Quote = USDC.
    const [baseBal, quoteBal, tokenSupply] = await Promise.all([
      conn.getTokenAccountBalance(pool.poolBaseTokenAccount).catch(() => null),
      conn.getTokenAccountBalance(pool.poolQuoteTokenAccount).catch(() => null),
      conn.getTokenSupply(mintPk).catch(() => null),
    ]);

    const liquidityToken = baseBal?.value.uiAmount ?? null;
    const liquidityUsdc = quoteBal?.value.uiAmount ?? null;
    if (liquidityToken == null || liquidityUsdc == null || liquidityToken <= 0) {
      return null;
    }

    const priceUsd = liquidityUsdc / liquidityToken;
    const liquidityUsd = liquidityUsdc * 2; // USDC side + equal-valued token side.
    const supply = tokenSupply?.value.uiAmount ?? TOKEN_SUPPLY_FALLBACK;
    const marketCapUsd = priceUsd * supply;

    return { priceUsd, marketCapUsd, liquidityUsd, liquidityToken, liquidityUsdc };
  } catch {
    return null;
  }
}

async function fetchOnchainPool(
  conn: Connection,
  mint: string,
): Promise<Partial<DexStats>> {
  const mintPk = new PublicKey(mint);
  const usdcPk = new PublicKey(USDC_MINT);
  const devWallet = loadPubkey();

  // 1) Our own bot-created pool (works pre- and post-bond).
  const ownPool = poolPda(OWN_POOL_INDEX, new PublicKey(devWallet), mintPk, usdcPk);
  const own = await readPoolReserves(conn, mint, ownPool);
  if (own) return own;

  // 2) The canonical PumpSwap pool (exists once graduated).
  const canonical = await readPoolReserves(conn, mint, canonicalPumpPoolPda(mintPk, usdcPk));
  if (canonical) return canonical;

  // 3) Pre-graduation: read the bonding curve so the boxes still populate.
  return fetchBondingCurveStats(conn, mint);
}

/**
 * Pre-graduation liquidity comes from the bonding curve, not an LP pool. We
 * read the curve's reserves so the stats boxes populate while the token is
 * still on pump.fun (before it shows up on DexScreener / PumpSwap).
 */
async function fetchBondingCurveStats(
  conn: Connection,
  mint: string,
): Promise<Partial<DexStats>> {
  try {
    const mintPk = new PublicKey(mint);
    const sdk = new PumpSdk();
    const bcInfo = await conn.getAccountInfo(bondingCurvePda(mintPk));
    if (!bcInfo) return {};
    const bc = sdk.decodeBondingCurveNullable(bcInfo);
    if (!bc || bc.complete) return {};

    const [tokenSupply, mintDecimals] = await Promise.all([
      conn.getTokenSupply(mintPk).catch(() => null),
      conn.getTokenSupply(mintPk).then((r) => r.value.decimals).catch(() => 6),
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
  const [dexRaw, onchain, txs] = await Promise.all([
    fetchDex(mint),
    fetchOnchainPool(conn, mint),
    fetchTxs(conn, devWallet, mint),
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
  return { mint, devWallet, dex, txs, lastCycleAt, cycleIntervalSec: 60 };
});
