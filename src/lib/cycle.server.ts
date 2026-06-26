import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import BN from "bn.js";
import {
  PumpAmmSdk,
  OnlinePumpAmmSdk,
  canonicalPumpPoolPda,
  coinCreatorVaultAtaPda,
  coinCreatorVaultAuthorityPda,
} from "@pump-fun/pump-swap-sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

/**
 * Liquititty auto-cycle (USDC-quoted pump.fun coin).
 * Shared between the cron route (/api/public/run-cycle) and the
 * built-in scheduler route (/api/public/tick).
 */

const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP = "https://quote-api.jup.ag/v6/swap";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const BUYBACK_PCT = 0.35;
const PRIORITY_FEE_SOL = 0.0005;
const SLIPPAGE_BPS = 1500;
const POOL_SLIPPAGE_PCT = 10;
const MAX_LP_RETRIES = 6;
const LP_SHRINK_FACTOR = 0.85;

export const CYCLE_INTERVAL_SEC = 60; // TEMP: set to 60 for testing, restore to 300 (5 min) later

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

async function getTokenAccountUiBalance(conn: Connection, tokenAccount: PublicKey): Promise<number> {
  try {
    const balance = await conn.getTokenAccountBalance(tokenAccount);
    return balance.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

async function sendInstructions(
  conn: Connection,
  signer: Keypair,
  ixs: TransactionInstruction[],
): Promise<string> {
  const latest = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([signer]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await conn.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return sig;
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

  // STEP 1: claim PumpSwap USDC creator fees directly with the official SDK.
  // PumpPortal's collectCreatorFee path was building/claiming the old WSOL vault,
  // which produced successful-looking txs but 0 USDC claimed for this USDC pair.
  const usdcBefore = await getTokenUiBalance(conn, pubkey, USDC_MINT);
  try {
    const offlineSdk = new PumpAmmSdk();
    const coinCreator = signer.publicKey;
    const quoteMint = new PublicKey(USDC_MINT);
    const quoteTokenProgram = TOKEN_PROGRAM_ID;
    const coinCreatorVaultAuthority = coinCreatorVaultAuthorityPda(coinCreator);
    const coinCreatorVaultAta = coinCreatorVaultAtaPda(
      coinCreatorVaultAuthority,
      quoteMint,
      quoteTokenProgram,
    );
    const coinCreatorTokenAccount = getAssociatedTokenAddressSync(
      quoteMint,
      coinCreator,
      true,
      quoteTokenProgram,
    );

    const vaultUsdc = await getTokenAccountUiBalance(conn, coinCreatorVaultAta);
    steps.push({
      step: "claimable_usdc_vault",
      ok: true,
      info: { usdc: vaultUsdc, vault: coinCreatorVaultAta.toBase58() },
    });

    if (vaultUsdc < 0.000001) {
      steps.push({ step: "skip", ok: true, info: "no USDC creator rewards in PumpSwap vault" });
      return { ok: true, steps };
    }

    const [coinCreatorVaultAtaAccountInfo, coinCreatorTokenAccountInfo] =
      await conn.getMultipleAccountsInfo([coinCreatorVaultAta, coinCreatorTokenAccount]);

    const claimIxs = await offlineSdk.collectCoinCreatorFee(
      {
        coinCreator,
        quoteMint,
        quoteTokenProgram,
        coinCreatorVaultAuthority,
        coinCreatorVaultAta,
        coinCreatorTokenAccount,
        coinCreatorVaultAtaAccountInfo,
        coinCreatorTokenAccountInfo,
      },
      signer.publicKey,
    );

    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor((PRIORITY_FEE_SOL * 1e9 * 1e6) / 250_000),
      }),
      createAssociatedTokenAccountIdempotentInstruction(
        signer.publicKey,
        coinCreatorTokenAccount,
        coinCreator,
        quoteMint,
        quoteTokenProgram,
      ),
      ...claimIxs,
    ];

    const sig = await sendInstructions(conn, signer, ixs);
    steps.push({ step: "claim", ok: true, signature: sig, info: { quoteMint: USDC_MINT } });
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

  // STEP 3: LP via PumpSwap SDK with retry-on-shrink
  try {
    const tokenAvail = await getTokenUiBalance(conn, pubkey, mint);
    const usdcAvail = await getTokenUiBalance(conn, pubkey, USDC_MINT);
    if (tokenAvail <= 0) throw new Error("no token balance to LP");
    if (usdcAvail <= 0) throw new Error("no USDC balance to LP");

    const mintPk = new PublicKey(mint);
    const usdcPk = new PublicKey(USDC_MINT);
    const userPk = signer.publicKey;

    // Resolve canonical PumpSwap pool for this USDC-quoted mint.
    const poolPk = canonicalPumpPoolPda(mintPk, usdcPk);
    const onlineSdk = new OnlinePumpAmmSdk(conn);
    const offlineSdk = new PumpAmmSdk();
    const liqState = await onlineSdk.liquiditySolanaState(poolPk, userPk);

    // Verify base/quote ordering. If mint is the quote (unlikely on pump.fun
    // USDC pools but defensive), abort cleanly.
    if (!liqState.pool.baseMint.equals(mintPk)) {
      throw new Error(
        `pool base mint mismatch: pool.base=${liqState.pool.baseMint.toBase58()} expected=${mint}`,
      );
    }
    const usdcDecimals = 6;
    let depositTokenUi = tokenAvail;

    let lastErr = "";
    for (let attempt = 0; attempt < MAX_LP_RETRIES; attempt++) {
      try {
        const baseRaw = new BN(
          BigInt(Math.floor(depositTokenUi * 10 ** tokenDecimals)).toString(),
        );
        // Ask the SDK what USDC + LP tokens this base amount maps to right now.
        const auto = offlineSdk.depositAutocompleteQuoteAndLpTokenFromBase(
          liqState,
          baseRaw,
          POOL_SLIPPAGE_PCT,
        );
        const usdcNeededUi = Number(auto.quote.toString()) / 10 ** usdcDecimals;

        // If we don't have enough USDC, shrink token side to fit (leave 2% buffer).
        if (usdcNeededUi > usdcAvail) {
          const ratio = (usdcAvail * 0.98) / usdcNeededUi;
          depositTokenUi *= ratio;
          throw new Error(
            `insufficient USDC: need ${usdcNeededUi.toFixed(4)} have ${usdcAvail.toFixed(4)} -> shrink token to ${depositTokenUi}`,
          );
        }

        const lpIxs: TransactionInstruction[] = await offlineSdk.depositInstructions(
          liqState,
          auto.lpToken,
          POOL_SLIPPAGE_PCT,
        );

        const ixs: TransactionInstruction[] = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: Math.floor((PRIORITY_FEE_SOL * 1e9 * 1e6) / 600_000),
          }),
          ...lpIxs,
        ];

        const latest = await conn.getLatestBlockhash();
        const msg = new TransactionMessage({
          payerKey: userPk,
          recentBlockhash: latest.blockhash,
          instructions: ixs,
        }).compileToV0Message();
        const tx = new VersionedTransaction(msg);
        tx.sign([signer]);
        const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
        await conn.confirmTransaction(
          {
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          "confirmed",
        );
        steps.push({
          step: "addLiquidity",
          ok: true,
          signature: sig,
          info: {
            tokenDeposited: depositTokenUi,
            usdcDeposited: usdcNeededUi,
            attempt: attempt + 1,
          },
        });
        return { ok: true, steps };
      } catch (e) {
        lastErr = (e as Error).message;
        // Default shrink in case it wasn't a ratio issue.
        if (!lastErr.includes("insufficient USDC")) depositTokenUi *= LP_SHRINK_FACTOR;
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
