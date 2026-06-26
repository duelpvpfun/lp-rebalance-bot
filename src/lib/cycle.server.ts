import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Liquititty auto-cycle (USDC-quoted pump.fun coin).
 * Shared between the cron route (/api/public/run-cycle) and the
 * built-in scheduler route (/api/public/tick).
 */

const PUMPPORTAL_LOCAL = "https://pumpportal.fun/api/trade-local";
const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP = "https://quote-api.jup.ag/v6/swap";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const BUYBACK_PCT = 0.35;
const PRIORITY_FEE_SOL = 0.0005;
const SLIPPAGE_BPS = 1500;
const POOL_SLIPPAGE_PCT = 10;
const MAX_LP_RETRIES = 6;
const LP_SHRINK_FACTOR = 0.85;

export const CYCLE_INTERVAL_SEC = 300;

export type StepResult = {
  step: string;
  ok: boolean;
  signature?: string;
  info?: unknown;
  error?: string;
};

export function rpcUrl(): string {
  const helius = process.env.HELIUS_API_KEY;
  if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
  return process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}

export function loadKeypair(): Keypair {
  const pk = process.env.DEV_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error("DEV_WALLET_PRIVATE_KEY missing");
  if (pk.trim().startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pk)));
  return Keypair.fromSecretKey(bs58.decode(pk.trim()));
}

async function signAndSend(conn: Connection, signer: Keypair, txBytes: ArrayBuffer): Promise<string> {
  const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
  tx.sign([signer]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  const latest = await conn.getLatestBlockhash();
  await conn.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

async function pumpPortalLocal(body: Record<string, unknown>): Promise<ArrayBuffer> {
  const res = await fetch(PUMPPORTAL_LOCAL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PumpPortal ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

async function getTokenUiBalance(conn: Connection, owner: string, mint: string): Promise<number> {
  const accounts = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), {
    mint: new PublicKey(mint),
  });
  let total = 0;
  for (const a of accounts.value) {
    total += Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0);
  }
  return total;
}

async function getTokenDecimals(conn: Connection, mint: string): Promise<number> {
  const info = await conn.getParsedAccountInfo(new PublicKey(mint));
  // @ts-expect-error parsed shape
  return info.value?.data?.parsed?.info?.decimals ?? 6;
}

async function priceTokenInUsdc(mint: string, tokenRaw: string): Promise<number> {
  const url =
    `${JUPITER_QUOTE}?inputMint=${mint}&outputMint=${USDC_MINT}` +
    `&amount=${tokenRaw}&slippageBps=50&swapMode=ExactIn`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Jupiter price ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return Number(j.outAmount);
}

export async function runCycle(): Promise<{ ok: boolean; steps: StepResult[] }> {
  const steps: StepResult[] = [];
  const mint = process.env.TOKEN_MINT_ADDRESS;
  if (!mint) throw new Error("TOKEN_MINT_ADDRESS missing");

  const signer = loadKeypair();
  const pubkey = signer.publicKey.toBase58();
  const conn = new Connection(rpcUrl(), "confirmed");
  const tokenDecimals = await getTokenDecimals(conn, mint);

  // STEP 1: claim
  const usdcBefore = await getTokenUiBalance(conn, pubkey, USDC_MINT);
  try {
    const txBuf = await pumpPortalLocal({
      publicKey: pubkey,
      action: "collectCreatorFee",
      priorityFee: PRIORITY_FEE_SOL,
    });
    const sig = await signAndSend(conn, signer, txBuf);
    steps.push({ step: "claim", ok: true, signature: sig });
  } catch (e) {
    steps.push({ step: "claim", ok: false, error: (e as Error).message });
    return { ok: false, steps };
  }

  await new Promise((r) => setTimeout(r, 4000));
  const usdcAfter = await getTokenUiBalance(conn, pubkey, USDC_MINT);
  const claimedUsdc = Math.max(0, usdcAfter - usdcBefore);
  steps.push({ step: "claimed_amount", ok: true, info: { usdc: claimedUsdc } });

  if (claimedUsdc < 0.5) {
    steps.push({ step: "skip", ok: true, info: "claimed USDC too small, abort" });
    return { ok: true, steps };
  }

  // STEP 2: swap 35% USDC -> token
  const buybackUsdcUi = claimedUsdc * BUYBACK_PCT;
  const buybackUsdcRaw = Math.floor(buybackUsdcUi * 1e6);
  try {
    const quoteUrl =
      `${JUPITER_QUOTE}?inputMint=${USDC_MINT}&outputMint=${mint}` +
      `&amount=${buybackUsdcRaw}&slippageBps=${SLIPPAGE_BPS}`;
    const quoteRes = await fetch(quoteUrl);
    if (!quoteRes.ok) throw new Error(`Jupiter quote ${quoteRes.status}: ${await quoteRes.text()}`);
    const quote = await quoteRes.json();
    const swapRes = await fetch(JUPITER_SWAP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: pubkey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: Math.floor(PRIORITY_FEE_SOL * 1e9),
      }),
    });
    if (!swapRes.ok) throw new Error(`Jupiter swap ${swapRes.status}: ${await swapRes.text()}`);
    const { swapTransaction } = await swapRes.json();
    const txBytes = Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0));
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([signer]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const latest = await conn.getLatestBlockhash();
    await conn.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    steps.push({ step: "swap", ok: true, signature: sig, info: { spentUsdc: buybackUsdcUi } });
  } catch (e) {
    steps.push({ step: "swap", ok: false, error: (e as Error).message });
    return { ok: false, steps };
  }

  await new Promise((r) => setTimeout(r, 4000));

  // STEP 3: LP with retry-on-shrink
  try {
    const tokenAvail = await getTokenUiBalance(conn, pubkey, mint);
    const usdcAvail = await getTokenUiBalance(conn, pubkey, USDC_MINT);
    if (tokenAvail <= 0) throw new Error("no token balance to LP");
    if (usdcAvail <= 0) throw new Error("no USDC balance to LP");

    const tokenRaw = BigInt(Math.floor(tokenAvail * 10 ** tokenDecimals)).toString();
    const usdcNeededRaw = await priceTokenInUsdc(mint, tokenRaw);
    const usdcNeededUi = usdcNeededRaw / 1e6;

    let depositTokenUi = tokenAvail;
    if (usdcNeededUi > usdcAvail) {
      depositTokenUi = tokenAvail * ((usdcAvail * 0.98) / usdcNeededUi);
    }

    let lastErr = "";
    for (let attempt = 0; attempt < MAX_LP_RETRIES; attempt++) {
      try {
        const txBuf = await pumpPortalLocal({
          publicKey: pubkey,
          action: "depositLiquidity",
          mint,
          amount: depositTokenUi,
          denominatedInSol: "false",
          slippage: POOL_SLIPPAGE_PCT,
          priorityFee: PRIORITY_FEE_SOL,
          pool: "pump-amm",
        });
        const sig = await signAndSend(conn, signer, txBuf);
        steps.push({
          step: "addLiquidity",
          ok: true,
          signature: sig,
          info: { tokenDeposited: depositTokenUi, attempt: attempt + 1 },
        });
        return { ok: true, steps };
      } catch (e) {
        lastErr = (e as Error).message;
        depositTokenUi *= LP_SHRINK_FACTOR;
        steps.push({
          step: `addLiquidity_retry_${attempt + 1}`,
          ok: false,
          error: lastErr,
          info: { nextTokenAmount: depositTokenUi },
        });
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw new Error(`LP failed after ${MAX_LP_RETRIES} retries: ${lastErr}`);
  } catch (e) {
    steps.push({ step: "addLiquidity", ok: false, error: (e as Error).message });
    return { ok: false, steps };
  }
}

/**
 * Single-flight lock + on-chain timestamp gate so the built-in scheduler
 * (polled by the website) can safely fire `runCycle` at most once every
 * CYCLE_INTERVAL_SEC even with multiple concurrent visitors.
 *
 * The lock is in-memory per Worker isolate; the timestamp gate is the real
 * source of truth (read from the dev wallet's recent signatures).
 */
let inFlight: Promise<{ ok: boolean; steps: StepResult[] }> | null = null;
let lastRunAtMs = 0;

const PUMP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

async function readLastCycleTsSec(): Promise<number | null> {
  try {
    const signer = loadKeypair();
    const conn = new Connection(rpcUrl(), "confirmed");
    const sigs = await conn.getSignaturesForAddress(signer.publicKey, { limit: 25 });
    const parsed = await Promise.all(
      sigs.map((s) =>
        conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null),
      ),
    );
    for (let i = 0; i < sigs.length; i++) {
      const s = sigs[i];
      const tx = parsed[i];
      if (!tx || s.err) continue;
      const pids = new Set<string>();
      for (const ix of tx.transaction.message.instructions ?? []) {
        const pid = (ix as { programId?: PublicKey }).programId?.toBase58();
        if (pid) pids.add(pid);
      }
      for (const inner of tx.meta?.innerInstructions ?? []) {
        for (const ix of inner.instructions ?? []) {
          const pid = (ix as { programId?: PublicKey }).programId?.toBase58();
          if (pid) pids.add(pid);
        }
      }
      if (pids.has(PUMP_AMM) || pids.has(PUMP_FUN) || pids.has(JUPITER_V6)) {
        return s.blockTime ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export type TickResult =
  | { ran: true; ok: boolean; steps: StepResult[]; secondsUntilNext: number }
  | { ran: false; reason: "cooldown" | "in_flight"; secondsUntilNext: number };

export async function tick(): Promise<TickResult> {
  const now = Date.now();

  if (inFlight) {
    return { ran: false, reason: "in_flight", secondsUntilNext: CYCLE_INTERVAL_SEC };
  }

  const lastChainSec = await readLastCycleTsSec();
  const lastSec = Math.max(lastRunAtMs / 1000, lastChainSec ?? 0);
  const elapsed = now / 1000 - lastSec;
  if (lastSec > 0 && elapsed < CYCLE_INTERVAL_SEC) {
    return {
      ran: false,
      reason: "cooldown",
      secondsUntilNext: Math.ceil(CYCLE_INTERVAL_SEC - elapsed),
    };
  }

  lastRunAtMs = now;
  inFlight = runCycle();
  try {
    const result = await inFlight;
    return { ran: true, ok: result.ok, steps: result.steps, secondsUntilNext: CYCLE_INTERVAL_SEC };
  } finally {
    inFlight = null;
  }
}
