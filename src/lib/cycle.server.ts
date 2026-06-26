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
  poolPda,
  lpMintPda,
} from "@pump-fun/pump-swap-sdk";
import {
  PumpSdk,
  OnlinePumpSdk,
  bondingCurvePda,
  creatorVaultPda,
  getBuyTokenAmountFromSolAmount,
} from "@pump-fun/pump-sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

/**
 * Liquititty auto-cycle (USDC-quoted pump.fun coin).
 * Shared by the authenticated cron/manual route.
 *
 * The whole cycle runs against the canonical PumpSwap pool via the official
 * SDK — claim, buyback and LP all use the same pool and the same USDC quote
 * token, so there is no dependency on any third-party swap aggregator.
 */

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const BUYBACK_PCT = 0.35;
const PRIORITY_FEE_SOL = 0.0001;
const SLIPPAGE_BPS = 1500;
const POOL_SLIPPAGE_PCT = 10;
const MAX_LP_RETRIES = 6;
const LP_SHRINK_FACTOR = 0.85;
const MIN_SOL_BALANCE = 0.02;

// Index for the bot-owned PumpSwap pool (the one we create + seed ourselves,
// distinct from pump.fun's canonical pool created at graduation). Override via
// env if you ever need a fresh pool. We add liquidity here both pre- and
// post-bond so the LP grows every cycle regardless of graduation status.
const OWN_POOL_INDEX = Number(process.env.LP_POOL_INDEX ?? "1");
// Minimum USDC to bother creating/seeding a brand-new pool on the first run.
const MIN_SEED_USDC = 1;

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

async function getTokenAccountUiBalance(
  conn: Connection,
  tokenAccount: PublicKey,
): Promise<number> {
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
  timeoutMs: number = 22_000,
  onBroadcast?: (signature: string) => Promise<void> | void,
  beforeBroadcast?: () => Promise<void> | void,
): Promise<string> {
  // Prepend priority-fee + compute-limit so the tx actually lands on a busy
  // network. Without these, Helius/public RPC frequently sees the blockhash
  // expire ("block height exceeded") before the leader picks the tx up.
  const hasComputePrice = ixs.some(
    (ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 3,
  );
  const hasComputeLimit = ixs.some(
    (ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 2,
  );
  const prepend: TransactionInstruction[] = [];
  if (!hasComputeLimit) {
    prepend.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  }
  if (!hasComputePrice) {
    // ~0.0001 SOL on a 400k CU tx — enough priority without draining SOL.
    prepend.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor((PRIORITY_FEE_SOL * 1e9 * 1e6) / 400_000),
      }),
    );
  }
  const finalIxs = [...prepend, ...ixs];

  const latest = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: finalIxs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([signer]);
  const raw = tx.serialize();

  try {
    await beforeBroadcast?.();
  } catch (e) {
    throw new Error(`progress save failed before tx broadcast: ${(e as Error).message}`);
  }

  // Send with skipPreflight + manual rebroadcast loop until the tx confirms
  // or the blockhash expires. This is the pattern Helius/Jito recommend for
  // landing txs reliably on mainnet.
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  try {
    await onBroadcast?.(sig);
  } catch (e) {
    throw new Error(`tx ${sig} broadcast but progress save failed: ${(e as Error).message}`);
  }

  // 22s confirm window — keeps every step well under the serverless 30s host
  // timeout. Each tick runs exactly one step, so we don't need the long 75s
  // wait we used when claim+buy+LP+burn ran in a single request.
  const deadlineMs = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadlineMs) {
    try {
      const status = await conn.getSignatureStatus(sig, { searchTransactionHistory: false });
      const s = status?.value;
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
        if (s.err) throw new Error(`tx failed: ${JSON.stringify(s.err)}`);
        return sig;
      }
      await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(
    `tx ${sig} did not confirm within ${Math.round(timeoutMs / 1000)}s${lastErr ? `: ${(lastErr as Error).message}` : ""}`,
  );
}



async function getTokenDecimals(conn: Connection, mint: string): Promise<number> {
  const info = await conn.getParsedAccountInfo(new PublicKey(mint));
  // @ts-expect-error parsed shape
  return info.value?.data?.parsed?.info?.decimals ?? 6;
}

/**
 * Detect which token program owns a mint. pump.fun increasingly launches coins
 * under Token-2022, while USDC is legacy SPL Token — passing the wrong program
 * makes buys/LP fail with `IncorrectProgramId`, so we always resolve it live.
 */
async function getMintTokenProgram(conn: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await conn.getAccountInfo(mint);
  if (info?.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

/**
 * Add liquidity to our OWN PumpSwap pool (index = OWN_POOL_INDEX, creator =
 * the dev wallet). This works whether or not the token has graduated, because
 * a PumpSwap AMM pool is independent of the pump.fun bonding curve — you can
 * create and seed one at any time.
 *
 * - First run: the pool doesn't exist yet, so we CREATE it and seed it with the
 *   token + USDC we hold, at the given spot price.
 * - Subsequent runs: the pool exists, so we DEPOSIT (token + matching USDC),
 *   shrinking the token side if USDC is the limiting factor.
 *
 * `spotPriceUsdcPerToken` is the price we use to balance the two sides for the
 * very first seed (so the new pool opens near the real market price).
 */
async function addToOwnPool(
  conn: Connection,
  signer: Keypair,
  mint: string,
  tokenDecimals: number,
  spotPriceUsdcPerToken: number,
  steps: StepResult[],
  afterBroadcast?: (signature: string) => Promise<void>,
): Promise<boolean> {
  const mintPk = new PublicKey(mint);
  const usdcPk = new PublicKey(USDC_MINT);
  const userPk = signer.publicKey;
  const usdcDecimals = 6;

  const tokenAvail = await getTokenUiBalance(conn, signer.publicKey.toBase58(), mint);
  const usdcAvail = await getTokenUiBalance(conn, signer.publicKey.toBase58(), USDC_MINT);
  if (tokenAvail <= 0) {
    steps.push({ step: "addLiquidity", ok: false, error: "no token balance to LP" });
    return false;
  }
  if (usdcAvail <= 0) {
    steps.push({ step: "addLiquidity", ok: false, error: "no USDC balance to LP" });
    return false;
  }

  const onlineSdk = new OnlinePumpAmmSdk(conn);
  const offlineSdk = new PumpAmmSdk();
  const poolPk = poolPda(OWN_POOL_INDEX, userPk, mintPk, usdcPk);
  const poolInfo = await conn.getAccountInfo(poolPk);

  // ---- First run: create + seed the pool ----
  if (!poolInfo) {
    if (usdcAvail < MIN_SEED_USDC) {
      steps.push({
        step: "createPool",
        ok: true,
        info: `waiting: need >= ${MIN_SEED_USDC} USDC to seed a new pool, have ${usdcAvail.toFixed(4)}`,
      });
      return false;
    }
    try {
      // Balance both sides at the spot price so the pool opens at market.
      let seedTokenUi = tokenAvail;
      let seedUsdcUi = seedTokenUi * spotPriceUsdcPerToken;
      if (seedUsdcUi > usdcAvail) {
        seedUsdcUi = usdcAvail;
        seedTokenUi = spotPriceUsdcPerToken > 0 ? seedUsdcUi / spotPriceUsdcPerToken : tokenAvail;
      }
      const baseIn = new BN(BigInt(Math.floor(seedTokenUi * 10 ** tokenDecimals)).toString());
      const quoteIn = new BN(BigInt(Math.floor(seedUsdcUi * 10 ** usdcDecimals)).toString());

      const createState = await onlineSdk.createPoolSolanaState(
        OWN_POOL_INDEX,
        userPk,
        mintPk,
        usdcPk,
      );
      const createIxs = await offlineSdk.createPoolInstructions(createState, baseIn, quoteIn);
      const ixs: TransactionInstruction[] = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: Math.floor((PRIORITY_FEE_SOL * 1e9 * 1e6) / 600_000),
        }),
        ...createIxs,
      ];
      const sig = await sendInstructions(conn, signer, ixs, 22_000, afterBroadcast);
      steps.push({
        step: "createPool",
        ok: true,
        signature: sig,
        info: {
          pool: poolPk.toBase58(),
          seededToken: seedTokenUi,
          seededUsdc: seedUsdcUi,
          index: OWN_POOL_INDEX,
        },
      });
      return true;
    } catch (e) {
      steps.push({ step: "createPool", ok: false, error: (e as Error).message });
      return false;
    }
  }

  // ---- Pool exists: deposit (token + matching USDC) with retry-on-shrink ----
  try {
    const liqState = await onlineSdk.liquiditySolanaState(poolPk, userPk);
    if (!liqState.pool.baseMint.equals(mintPk)) {
      throw new Error(
        `pool base mint mismatch: pool.base=${liqState.pool.baseMint.toBase58()} expected=${mint}`,
      );
    }

    let depositTokenUi = tokenAvail;
    let lastErr = "";
    for (let attempt = 0; attempt < MAX_LP_RETRIES; attempt++) {
      try {
        const baseRaw = new BN(BigInt(Math.floor(depositTokenUi * 10 ** tokenDecimals)).toString());
        const auto = offlineSdk.depositAutocompleteQuoteAndLpTokenFromBase(
          liqState,
          baseRaw,
          POOL_SLIPPAGE_PCT,
        );
        const usdcNeededUi = Number(auto.quote.toString()) / 10 ** usdcDecimals;

        if (usdcNeededUi > usdcAvail) {
          const ratio = (usdcAvail * 0.98) / usdcNeededUi;
          depositTokenUi *= ratio;
          throw new Error(
            `insufficient USDC: need ${usdcNeededUi.toFixed(4)} have ${usdcAvail.toFixed(4)} -> shrink token to ${depositTokenUi}`,
          );
        }

        const lpIxs = await offlineSdk.depositInstructions(
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
        const sig = await sendInstructions(conn, signer, ixs, 22_000, afterBroadcast);
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
        return true;
      } catch (e) {
        lastErr = (e as Error).message;
        if (lastErr.includes("did not confirm") || lastErr.includes("broadcast but progress save failed")) {
          steps.push({
            step: "addLiquidity_confirmation_unknown",
            ok: true,
            error: lastErr,
            info: "LP tx was broadcast but confirmation timed out; advancing to burn instead of retrying a possible landed deposit",
          });
          return true;
        }
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
    return false;
  }
}

/**
 * Burn ALL LP tokens the dev wallet holds for our pool. Creating/seeding a pool
 * and every deposit mint LP tokens to the dev wallet — burning them permanently
 * locks that liquidity (it can never be withdrawn by anyone, including us). This
 * is the on-chain proof that the liquidity is locked forever.
 */
async function burnLpTokens(
  conn: Connection,
  signer: Keypair,
  mint: string,
  steps: StepResult[],
): Promise<void> {
  try {
    const mintPk = new PublicKey(mint);
    const usdcPk = new PublicKey(USDC_MINT);
    const userPk = signer.publicKey;
    const poolPk = poolPda(OWN_POOL_INDEX, userPk, mintPk, usdcPk);
    const lpMint = lpMintPda(poolPk);

    // LP mints may live under the SPL Token or Token-2022 program — detect which
    // from the mint's owner so the burn always targets the right program.
    const lpMintInfo = await conn.getAccountInfo(lpMint);
    const lpTokenProgram = lpMintInfo?.owner ?? TOKEN_PROGRAM_ID;
    const lpAta = getAssociatedTokenAddressSync(lpMint, userPk, true, lpTokenProgram);

    const bal = await conn.getTokenAccountBalance(lpAta).catch(() => null);
    const raw = bal?.value.amount ? BigInt(bal.value.amount) : 0n;
    if (raw <= 0n) {
      steps.push({ step: "burnLp", ok: true, info: "no LP tokens to burn" });
      return;
    }

    const burnIx = createBurnInstruction(lpAta, lpMint, userPk, raw, [], lpTokenProgram);
    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor((PRIORITY_FEE_SOL * 1e9 * 1e6) / 60_000),
      }),
      burnIx,
    ];
    const sig = await sendInstructions(conn, signer, ixs);
    steps.push({
      step: "burnLp",
      ok: true,
      signature: sig,
      info: { lpMint: lpMint.toBase58(), burned: bal?.value.uiAmount ?? null },
    });
  } catch (e) {
    steps.push({ step: "burnLp", ok: false, error: (e as Error).message });
  }
}

/* ============================================================================
 * LOCKED CYCLE STATE MACHINE
 *
 * Write paths can only advance through the DB lease and persisted cooldown.
 * The fixed order is claim → buy → lp → burn. A new claim is only allowed when
 * the persisted cooldown has ended AND the lease was acquired. Read-only status
 * calls can never sign transactions.
 * ========================================================================== */

type Phase = "claim" | "buy" | "lp" | "burn";

const MAX_STEP_ATTEMPTS = 4;
const STATE_ID = "liquititty-auto-lp";
const LEASE_SECONDS = 180;
const STALE_CYCLE_MS = 5 * 60 * 1000;
const MIN_CLAIM_USDC = 0.01;
const LAST_SIG_READ_RETRIES = 3;
const LAST_SIG_READ_BACKOFF_MS = 350;

type LastCycleRead = number | "empty" | "error";

type CycleState = {
  phase: Phase;
  cycleStartMs: number;
  cooldownUntilMs: number;
  claimedUsdc: number;
  spotPrice: number;
  attempts: number;
  leaseOwner?: string;
};

function isPhase(value: unknown): value is Phase {
  return value === "claim" || value === "buy" || value === "lp" || value === "burn";
}

function cooldownState(nowMs = Date.now()): CycleState {
  return {
    phase: "claim",
    cycleStartMs: 0,
    cooldownUntilMs: nowMs + CYCLE_INTERVAL_SEC * 1000,
    claimedUsdc: 0,
    spotPrice: 0,
    attempts: 0,
  };
}

function rowToCycleState(raw: unknown): CycleState {
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  if (!row) return cooldownState();
  return {
    phase: isPhase(row.phase) ? row.phase : "claim",
    cycleStartMs: row.cycle_start_at ? Date.parse(String(row.cycle_start_at)) : 0,
    cooldownUntilMs: row.cooldown_until ? Date.parse(String(row.cooldown_until)) : Date.now(),
    claimedUsdc: Number(row.claimed_usdc ?? 0),
    spotPrice: Number(row.spot_price ?? 0),
    attempts: Number(row.attempts ?? 0),
    leaseOwner: typeof row.lease_owner === "string" ? row.lease_owner : undefined,
  };
}

async function cycleDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    from: (table: string) => {
      select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }> } };
      update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> };
      upsert: (values: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
  };
}

async function ensureCycleStateRow(): Promise<CycleState> {
  const db = await cycleDb();
  const starter = cooldownState();
  const { error } = await db.from("cycle_runtime_state").upsert(
    {
      id: STATE_ID,
      phase: starter.phase,
      cycle_start_at: null,
      cooldown_until: new Date(starter.cooldownUntilMs).toISOString(),
      claimed_usdc: 0,
      spot_price: 0,
      attempts: 0,
      lease_owner: null,
      lease_expires_at: null,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`cycle state init failed: ${error.message}`);
  return starter;
}

async function readCycleState(): Promise<CycleState | null> {
  const db = await cycleDb();
  const { data, error } = await db
    .from("cycle_runtime_state")
    .select("*")
    .eq("id", STATE_ID)
    .maybeSingle();
  if (error) throw new Error(`cycle state read failed: ${error.message}`);
  return data ? rowToCycleState(data as Record<string, unknown>) : null;
}

async function acquireCycleLease(owner: string): Promise<CycleState | null> {
  const db = await cycleDb();
  const { data, error } = await db.rpc("acquire_cycle_runtime_lease", {
    p_id: STATE_ID,
    p_owner: owner,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw new Error(`cycle lease failed: ${error.message}`);
  // SETOF returns an array: empty => another isolate holds the lease.
  const row = Array.isArray(data) ? data[0] : data;
  // Guard against an all-NULL composite row (no id) => not acquired.
  if (!row || (row as { id?: unknown }).id == null) return null;
  return rowToCycleState(row);
}

async function reserveClaimProgress(
  owner: string,
  claimedUsdc: number,
  spotPrice: number,
): Promise<boolean> {
  const db = await cycleDb();
  const { data, error } = await db.rpc("reserve_cycle_claim", {
    p_id: STATE_ID,
    p_owner: owner,
    p_guard_seconds: CYCLE_INTERVAL_SEC,
    p_claimed_usdc: claimedUsdc,
    p_spot_price: spotPrice,
  });
  if (error) throw new Error(`claim reserve failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return !!row && (row as { id?: unknown }).id != null;
}

async function persistCycleState(state: CycleState): Promise<void> {
  const db = await cycleDb();
  const { error } = await db
    .from("cycle_runtime_state")
    .update({
      phase: state.phase,
      cycle_start_at: state.cycleStartMs > 0 ? new Date(state.cycleStartMs).toISOString() : null,
      cooldown_until: new Date(state.cooldownUntilMs).toISOString(),
      claimed_usdc: state.claimedUsdc,
      spot_price: state.spotPrice,
      attempts: state.attempts,
      lease_owner: null,
      lease_expires_at: null,
    })
    .eq("id", STATE_ID);
  if (error) throw new Error(`cycle state save failed: ${error.message}`);
}

async function persistCycleProgress(state: CycleState): Promise<void> {
  const db = await cycleDb();
  const { error } = await db
    .from("cycle_runtime_state")
    .update({
      phase: state.phase,
      cycle_start_at: state.cycleStartMs > 0 ? new Date(state.cycleStartMs).toISOString() : null,
      cooldown_until: new Date(state.cooldownUntilMs).toISOString(),
      claimed_usdc: state.claimedUsdc,
      spot_price: state.spotPrice,
      attempts: state.attempts,
      // IMPORTANT: do NOT clear lease_owner / lease_expires_at here. This is
      // used to pre-advance dangerous steps before broadcasting txs, while the
      // global lock stays held so no other isolate can run the next step early.
    })
    .eq("id", STATE_ID);
  if (error) throw new Error(`cycle progress save failed: ${error.message}`);
}

function startCycleIfNeeded(state: CycleState): CycleState {
  if (state.cycleStartMs > 0) return { ...state };
  return {
    ...state,
    cycleStartMs: Date.now(),
    claimedUsdc: 0,
    spotPrice: 0,
    attempts: 0,
  };
}

function abortCycleState(): CycleState {
  // Always restart the 1-min cooldown after ANY cycle end (success, skip, or
  // hard failure). This is what prevents immediate re-claims/re-buys.
  return cooldownState();
}

function resetCycleAfterBurnState(): CycleState {
  return cooldownState();
}

function freshInMemoryState(): CycleState {
  return {
    phase: "claim",
    cycleStartMs: 0,
    cooldownUntilMs: Date.now(),
    claimedUsdc: 0,
    spotPrice: 0,
    attempts: 0,
  };
}

function mayHaveBroadcast(steps: StepResult[]): boolean {
  return steps.some(
    (s) => typeof s.error === "string" && /tx\s+[1-9A-HJ-NP-Za-km-z]{32,}\s+(did not confirm|broadcast)/i.test(s.error),
  );
}

export async function readLastCycleTsSec(
  conn?: Connection,
  wallet?: PublicKey,
): Promise<LastCycleRead> {
  const c = conn ?? new Connection(rpcUrl(), "confirmed");
  const w = wallet ?? loadKeypair().publicKey;
  for (let attempt = 1; attempt <= LAST_SIG_READ_RETRIES; attempt++) {
    try {
      // Newest dev-wallet signature of ANY kind at `confirmed` (NOT finalized).
      // finalized lags 10-30s, so a tx that JUST landed (e.g. the burn we just
      // sent) is invisible and the next tick re-claims. `confirmed` surfaces it
      // in ~2-5s. Do not filter by program: claim/buy/LP/burn all count.
      const sigs = await c.getSignaturesForAddress(w, { limit: 1 }, "confirmed");
      if (sigs.length === 0) return "empty";
      // A signature so fresh it has no blockTime yet still means "just acted".
      return sigs[0].blockTime ?? Math.floor(Date.now() / 1000);
    } catch {
      if (attempt < LAST_SIG_READ_RETRIES) {
        await new Promise((r) => setTimeout(r, LAST_SIG_READ_BACKOFF_MS * attempt));
      }
    }
  }
  return "error";
}

async function hardStartGate(
  conn: Connection,
  signer: Keypair,
  nowMs = Date.now(),
): Promise<{ step: StepResult; state: CycleState } | null> {
  const lastSigSec = await readLastCycleTsSec(conn, signer.publicKey);
  if (lastSigSec === "error") {
    return {
      step: { step: "skip", ok: true, info: { reason: "rpc_unavailable" } },
      state: cooldownState(nowMs),
    };
  }
  if (typeof lastSigSec === "number" && nowMs - lastSigSec * 1000 < CYCLE_INTERVAL_SEC * 1000) {
    const cooldownUntilMs = (lastSigSec + CYCLE_INTERVAL_SEC) * 1000;
    return {
      step: { step: "skip", ok: true, info: { reason: "cooldown" } },
      state: { ...cooldownState(cooldownUntilMs - CYCLE_INTERVAL_SEC * 1000), cooldownUntilMs },
    };
  }

  const solBalance = (await conn.getBalance(signer.publicKey, "confirmed")) / 1e9;
  if (solBalance < MIN_SOL_BALANCE) {
    return {
      step: { step: "skip", ok: true, info: { reason: "low_sol" } },
      state: abortCycleState(),
    };
  }

  return null;
}

async function walletCooldownState(
  conn: Connection,
  wallet: PublicKey,
  nowMs = Date.now(),
): Promise<CycleState | null> {
  const lastSigSec = await readLastCycleTsSec(conn, wallet);
  if (lastSigSec === "error") return cooldownState(nowMs);
  if (lastSigSec === "empty") return null;
  const cooldownUntilMs = (lastSigSec + CYCLE_INTERVAL_SEC) * 1000;
  return nowMs < cooldownUntilMs
    ? { ...cooldownState(cooldownUntilMs - CYCLE_INTERVAL_SEC * 1000), cooldownUntilMs }
    : null;
}


/* ----------------- STEP 1: claim USDC creator fees ----------------- */
async function stepClaim(
  conn: Connection,
  signer: Keypair,
  mint: string,
  tokenDecimals: number,
  beforeBroadcast?: (claimedUsdc: number, spotPriceUsdcPerToken: number) => Promise<void>,
): Promise<{
  results: StepResult[];
  claimedUsdc: number;
  expectedClaimableUsdc: number;
  spotPriceUsdcPerToken: number;
  skip: boolean;
  ok: boolean;
}> {
  const out: StepResult[] = [];
  let expectedClaimableUsdc = 0;
  const mintPk = new PublicKey(mint);
  const usdcPk = new PublicKey(USDC_MINT);
  const user = signer.publicKey;
  const pubkey = user.toBase58();

  const usdcBefore = await getTokenUiBalance(conn, pubkey, USDC_MINT);

  // Decide venue by reading the bonding curve once.
  const pumpSdk = new PumpSdk();
  const bcInfo = await conn.getAccountInfo(bondingCurvePda(mintPk));
  const bondingCurve = bcInfo ? pumpSdk.decodeBondingCurveNullable(bcInfo) : null;
  const isCurve = !!(bondingCurve && !bondingCurve.complete);

  // Compute spot price for first-run pool seeding (USDC per token).
  let spotPriceUsdcPerToken = 0;
  if (isCurve && bondingCurve) {
    const vToken = Number(bondingCurve.virtualTokenReserves.toString()) / 10 ** tokenDecimals;
    const vUsdc = Number(bondingCurve.virtualQuoteReserves.toString()) / 1e6;
    spotPriceUsdcPerToken = vToken > 0 ? vUsdc / vToken : 0;
  } else {
    spotPriceUsdcPerToken = await fetchAmmSpotPrice(conn, mint).catch(() => 0);
  }

  out.push({ step: "phase", ok: true, info: { phase: isCurve ? "bonding_curve" : "amm" } });

  try {
    if (isCurve) {
      const creator = bondingCurve!.creator;
      if (!creator.equals(user)) {
        out.push({
          step: "claim",
          ok: false,
          error: `dev wallet ${pubkey} is not the token creator ${creator.toBase58()} — cannot claim`,
        });
        return { results: out, claimedUsdc: 0, expectedClaimableUsdc, spotPriceUsdcPerToken, skip: true, ok: false };
      }
      const creatorVaultAuthority = creatorVaultPda(creator);
      const creatorVaultUsdcAta = getAssociatedTokenAddressSync(
        usdcPk,
        creatorVaultAuthority,
        true,
        TOKEN_PROGRAM_ID,
      );
      const claimableUsdc = await getTokenAccountUiBalance(conn, creatorVaultUsdcAta);
      expectedClaimableUsdc = claimableUsdc;
      out.push({
        step: "claimable_usdc_vault",
        ok: true,
        info: { usdc: claimableUsdc, vault: creatorVaultUsdcAta.toBase58() },
      });
      if (claimableUsdc < MIN_CLAIM_USDC) {
        out.push({
          step: "skip",
          ok: true,
          info: `bonding-curve vault below ${MIN_CLAIM_USDC} USDC (${claimableUsdc}); skipping cycle to avoid dust spam`,
        });
        return { results: out, claimedUsdc: 0, expectedClaimableUsdc, spotPriceUsdcPerToken, skip: true, ok: true };
      }
      const onlinePumpSdk = new OnlinePumpSdk(conn);
      const claimIxs = await onlinePumpSdk.collectCoinCreatorFeeV2Instructions(
        creator,
        usdcPk,
        TOKEN_PROGRAM_ID,
        user,
      );
      const sig = await sendInstructions(
        conn,
        signer,
        claimIxs,
        10_000,
        undefined,
        () => beforeBroadcast?.(claimableUsdc, spotPriceUsdcPerToken),
      );
      out.push({
        step: "claim",
        ok: true,
        signature: sig,
        info: { quoteMint: USDC_MINT, venue: "bonding_curve" },
      });
    } else {
      const offlineSdk = new PumpAmmSdk();
      const onlineSdk = new OnlinePumpAmmSdk(conn);
      const quoteTokenProgram = TOKEN_PROGRAM_ID;
      const poolPk = canonicalPumpPoolPda(mintPk, usdcPk);
      const pool = await onlineSdk.fetchPool(poolPk);
      const coinCreator = pool.coinCreator;
      if (!coinCreator.equals(user)) {
        out.push({
          step: "claim",
          ok: false,
          error: `dev wallet ${pubkey} is not the pool coinCreator ${coinCreator.toBase58()} — cannot claim`,
        });
        return { results: out, claimedUsdc: 0, expectedClaimableUsdc, spotPriceUsdcPerToken, skip: true, ok: false };
      }
      const coinCreatorVaultAuthority = coinCreatorVaultAuthorityPda(coinCreator);
      const coinCreatorVaultAta = coinCreatorVaultAtaPda(
        coinCreatorVaultAuthority,
        usdcPk,
        quoteTokenProgram,
      );
      const coinCreatorTokenAccount = getAssociatedTokenAddressSync(
        usdcPk,
        coinCreator,
        true,
        quoteTokenProgram,
      );
      const vaultUsdc = await getTokenAccountUiBalance(conn, coinCreatorVaultAta);
      expectedClaimableUsdc = vaultUsdc;
      out.push({
        step: "claimable_usdc_vault",
        ok: true,
        info: { usdc: vaultUsdc, vault: coinCreatorVaultAta.toBase58() },
      });
      if (vaultUsdc < MIN_CLAIM_USDC) {
        out.push({
          step: "skip",
          ok: true,
          info: `PumpSwap vault below ${MIN_CLAIM_USDC} USDC (${vaultUsdc}); skipping cycle to avoid dust spam`,
        });
        return { results: out, claimedUsdc: 0, expectedClaimableUsdc, spotPriceUsdcPerToken, skip: true, ok: true };
      }
      const [coinCreatorVaultAtaAccountInfo, coinCreatorTokenAccountInfo] =
        await conn.getMultipleAccountsInfo([coinCreatorVaultAta, coinCreatorTokenAccount]);
      const claimIxs = await offlineSdk.collectCoinCreatorFee(
        {
          coinCreator,
          quoteMint: usdcPk,
          quoteTokenProgram,
          coinCreatorVaultAuthority,
          coinCreatorVaultAta,
          coinCreatorTokenAccount,
          coinCreatorVaultAtaAccountInfo,
          coinCreatorTokenAccountInfo,
        },
        user,
      );
      const ixs: TransactionInstruction[] = [
        createAssociatedTokenAccountIdempotentInstruction(
          user,
          coinCreatorTokenAccount,
          coinCreator,
          usdcPk,
          quoteTokenProgram,
        ),
        ...claimIxs,
      ];
      const sig = await sendInstructions(
        conn,
        signer,
        ixs,
        10_000,
        undefined,
        () => beforeBroadcast?.(vaultUsdc, spotPriceUsdcPerToken),
      );
      out.push({
        step: "claim",
        ok: true,
        signature: sig,
        info: { quoteMint: USDC_MINT, venue: "amm" },
      });
    }
  } catch (e) {
    out.push({ step: "claim", ok: false, error: (e as Error).message });
    return { results: out, claimedUsdc: 0, expectedClaimableUsdc, spotPriceUsdcPerToken, skip: false, ok: false };
  }

  // Claim confirmed → USDC is in our ATA. Compute the delta to size the buy.
  const usdcAfter = await getTokenUiBalance(conn, pubkey, USDC_MINT);
  const claimedUsdc = Math.max(0, usdcAfter - usdcBefore);
  const claimBasisUsdc = Math.max(claimedUsdc, expectedClaimableUsdc);
  out.push({
    step: "claimed_amount",
    ok: true,
    info: { usdc: claimedUsdc, expectedUsdc: expectedClaimableUsdc, buyBasisUsdc: claimBasisUsdc },
  });
  return { results: out, claimedUsdc: claimBasisUsdc, expectedClaimableUsdc, spotPriceUsdcPerToken, skip: false, ok: true };
}

/* ----------------- STEP 2: buy 35% of claimed USDC into token ----------------- */
async function stepBuy(
  conn: Connection,
  signer: Keypair,
  mint: string,
  tokenDecimals: number,
  claimedUsdc: number,
  afterBroadcast?: (signature: string) => Promise<void>,
): Promise<{ results: StepResult[]; ok: boolean; skip: boolean }> {
  const out: StepResult[] = [];
  const walletUsdc = await getTokenUiBalance(conn, signer.publicKey.toBase58(), USDC_MINT);
  // Buy basis is STRICTLY the USDC claimed this cycle — never the full wallet
  // balance. Leftover USDC from earlier cycles or seed funding must not inflate
  // the buy. If the wallet somehow has less than claimed (e.g. partial spend),
  // cap to what's actually available.
  const claimBasisUsdc = Math.min(claimedUsdc, walletUsdc);
  if (claimBasisUsdc < MIN_CLAIM_USDC || walletUsdc < MIN_CLAIM_USDC) {
    out.push({ step: "skip", ok: true, info: "claimed USDC too small to buy" });
    return { results: out, ok: false, skip: true };
  }
  const buybackUsdcUi = Math.min(claimBasisUsdc * BUYBACK_PCT, walletUsdc * 0.98);
  const spendUsdcRaw = new BN(Math.floor(buybackUsdcUi * 1e6).toString());
  const mintPk = new PublicKey(mint);
  const usdcPk = new PublicKey(USDC_MINT);
  const user = signer.publicKey;

  const pumpSdk = new PumpSdk();
  const bcInfo = await conn.getAccountInfo(bondingCurvePda(mintPk));
  const bondingCurve = bcInfo ? pumpSdk.decodeBondingCurveNullable(bcInfo) : null;
  const isCurve = !!(bondingCurve && !bondingCurve.complete);

  try {
    if (isCurve) {
      const tokenProgram = await getMintTokenProgram(conn, mintPk);
      const onlinePumpSdk = new OnlinePumpSdk(conn);
      const global = await onlinePumpSdk.fetchGlobal();
      const feeConfig = await onlinePumpSdk.fetchFeeConfig().catch(() => null);
      const buyState = await onlinePumpSdk.fetchBuyState(mintPk, user, tokenProgram);
      const mintSupply = bondingCurve!.tokenTotalSupply ?? null;
      const expectedTokens = getBuyTokenAmountFromSolAmount({
        global,
        feeConfig,
        mintSupply,
        bondingCurve: buyState.bondingCurve,
        amount: spendUsdcRaw,
        quoteMint: usdcPk,
      });
      const buyIxs = await pumpSdk.buyV2Instructions({
        global,
        bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
        bondingCurve: buyState.bondingCurve,
        associatedUserAccountInfo: buyState.associatedUserAccountInfo,
        mint: mintPk,
        user,
        amount: expectedTokens,
        quoteAmount: spendUsdcRaw,
        slippage: SLIPPAGE_BPS / 100,
        tokenProgram,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
      });
      const sig = await sendInstructions(conn, signer, buyIxs, 22_000, afterBroadcast);
      out.push({
        step: "swap",
        ok: true,
        signature: sig,
        info: {
          spentUsdc: buybackUsdcUi,
          claimBasisUsdc,
          walletUsdc,
          estTokens: Number(expectedTokens.toString()) / 10 ** tokenDecimals,
          venue: "bonding_curve",
        },
      });
    } else {
      const onlineSdk = new OnlinePumpAmmSdk(conn);
      const offlineSdk = new PumpAmmSdk();
      const poolPk = canonicalPumpPoolPda(mintPk, usdcPk);
      const swapState = await onlineSdk.swapSolanaState(poolPk, user);
      if (!swapState.pool.baseMint.equals(mintPk)) {
        throw new Error(
          `pool base mint mismatch: pool.base=${swapState.pool.baseMint.toBase58()} expected=${mint}`,
        );
      }
      const buyIxs: TransactionInstruction[] = await offlineSdk.buyQuoteInput(
        swapState,
        spendUsdcRaw,
        SLIPPAGE_BPS / 100,
      );
      const sig = await sendInstructions(conn, signer, buyIxs, 22_000, afterBroadcast);
      out.push({
        step: "swap",
        ok: true,
        signature: sig,
        info: { spentUsdc: buybackUsdcUi, claimBasisUsdc, walletUsdc, venue: "amm" },
      });
    }
    return { results: out, ok: true, skip: false };
  } catch (e) {
    out.push({ step: "swap", ok: false, error: (e as Error).message });
    return { results: out, ok: false, skip: false };
  }
}

/* ----------------- STEP 3: add liquidity to own pool ----------------- */
async function stepLp(
  conn: Connection,
  signer: Keypair,
  mint: string,
  tokenDecimals: number,
  spotPriceUsdcPerToken: number,
  afterBroadcast?: (signature: string) => Promise<void>,
): Promise<{ results: StepResult[]; ok: boolean }> {
  const out: StepResult[] = [];
  const ok = await addToOwnPool(conn, signer, mint, tokenDecimals, spotPriceUsdcPerToken, out, afterBroadcast);
  return { results: out, ok };
}

/* ----------------- STEP 4: burn all LP tokens ----------------- */
async function stepBurn(
  conn: Connection,
  signer: Keypair,
  mint: string,
): Promise<{ results: StepResult[]; ok: boolean }> {
  const out: StepResult[] = [];
  await burnLpTokens(conn, signer, mint, out);
  const ok = out.every((s) => s.ok);
  return { results: out, ok };
}

/* ----------------- One-step driver (private; runCycle holds the lease) ----------------- */
async function runCycleStep(state?: CycleState): Promise<{
  ok: boolean;
  phase: Phase;
  done: boolean;
  steps: StepResult[];
  state: CycleState;
}> {
  if (process.env.BOT_ENABLED !== "true") {
    return { ok: false, ran: false, reason: "disabled", steps: [], phase: "idle", secondsUntilNext: 0 } as any;
  }
  const mint = process.env.TOKEN_MINT_ADDRESS;
  if (!mint) throw new Error("TOKEN_MINT_ADDRESS missing");
  const signer = loadKeypair();
  const conn = new Connection(rpcUrl(), "confirmed");

  const inputState = state ?? freshInMemoryState();
  const isStartingNewCycle = inputState.phase === "claim" && inputState.claimedUsdc <= 0 && inputState.attempts === 0;
  if (isStartingNewCycle) {
    const gated = await hardStartGate(conn, signer);
    if (gated) {
      return {
        ok: true,
        phase: "claim",
        done: true,
        steps: [gated.step],
        state: gated.state,
      };
    }
  }

  const tokenDecimals = await getTokenDecimals(conn, mint);
  let nextState = startCycleIfNeeded(inputState);
  if (isStartingNewCycle) {
    // Mark the cycle active immediately after the hard gates pass, before any
    // network-heavy SDK calls or tx building. This makes the DB/UI source of
    // truth show "running" and prevents any caller from seeing an expired idle
    // row while the claim step is preparing.
    nextState.cooldownUntilMs = Date.now() + CYCLE_INTERVAL_SEC * 1000;
    await persistCycleProgress(nextState);
  }
  const currentPhase = nextState.phase;
  let steps: StepResult[] = [];
  let stepOk = false;
  let done = false;

  try {
    switch (currentPhase) {
      case "claim": {
        let broadcastClaimedUsdc = 0;
        let broadcastSpotPrice = 0;
        let claimProgressSaved = false;

        // Final safety gate immediately before the first transaction of a new
        // cycle. This uses the newest finalized dev-wallet signature of ANY
        // kind, so a tx that just landed blocks fresh claims across isolates.
        const walletCooldown = await walletCooldownState(conn, signer.publicKey);
        if (walletCooldown && isStartingNewCycle) {
          nextState = walletCooldown;
          done = true;
          stepOk = true;
          steps = [{ step: "cooldown", ok: true, info: "newest dev-wallet tx is still inside the 60s cooldown" }];
          break;
        }

        const r = await stepClaim(conn, signer, mint, tokenDecimals, async (expectedClaimedUsdc, spotPriceUsdcPerToken) => {
          // Pre-advance BEFORE broadcasting claim. If the host dies after this
          // point, the next tick buys instead of claiming again, which prevents
          // spam-claiming the vault and shrinking the eventual buy basis.
          broadcastClaimedUsdc = expectedClaimedUsdc;
          broadcastSpotPrice = spotPriceUsdcPerToken;
          const reserved = await reserveClaimProgress(
            inputState.leaseOwner ?? "",
            expectedClaimedUsdc,
            spotPriceUsdcPerToken,
          );
          if (!reserved) {
            throw new Error("claim already reserved by another runner — blocking duplicate claim tx");
          }
          claimProgressSaved = true;
          const claimGuardCooldown = Date.now() + CYCLE_INTERVAL_SEC * 1000;
          nextState.cooldownUntilMs = claimGuardCooldown;
          nextState.phase = "buy";
          nextState.claimedUsdc = expectedClaimedUsdc;
          nextState.spotPrice = spotPriceUsdcPerToken;
          nextState.attempts = 0;
          await persistCycleProgress({
            ...nextState,
            phase: "buy",
            claimedUsdc: expectedClaimedUsdc,
            spotPrice: spotPriceUsdcPerToken,
            attempts: 0,
            cooldownUntilMs: claimGuardCooldown,
          });
        });
        steps = r.results;
        if (r.skip) {
          nextState = abortCycleState();
          done = true;
          stepOk = r.ok;
          break;
        }
        if (r.ok) {
          nextState.claimedUsdc = r.claimedUsdc;
          nextState.spotPrice = r.spotPriceUsdcPerToken;
          if (r.claimedUsdc < MIN_CLAIM_USDC) {
            nextState = abortCycleState();
            done = true;
          } else {
            nextState.phase = "buy";
            nextState.attempts = 0;
          }
          stepOk = true;
        } else {
          if (claimProgressSaved || mayHaveBroadcast(steps)) {
            steps.push({
              step: "claim_confirmation_unknown",
              ok: true,
              info: "claim progress was saved before send/confirm failed; advancing to buy instead of claiming again",
            });
            nextState.claimedUsdc = broadcastClaimedUsdc;
            nextState.spotPrice = broadcastSpotPrice;
            nextState.phase = "buy";
            nextState.attempts = 0;
            stepOk = true;
          } else {
            // Claim failures before broadcast get exactly one try per minute.
            steps.push({ step: "claim", ok: false, error: "claim failed before broadcast — cooldown restarted" });
            nextState = abortCycleState();
            done = true;
          }
        }
        break;
      }
      case "buy": {
        // Pre-advance BEFORE broadcasting the buy. This fully closes the
        // serverless timeout window: no future tick can double-buy this claim.
        await persistCycleProgress({ ...nextState, phase: "lp", attempts: 0 });
        const r = await stepBuy(conn, signer, mint, tokenDecimals, nextState.claimedUsdc);
        steps = r.results;
        if (r.skip) {
          // can't buy → still try to LP whatever we hold next tick.
          nextState.phase = "lp";
          nextState.attempts = 0;
          stepOk = true;
        } else if (r.ok) {
          nextState.phase = "lp";
          nextState.attempts = 0;
          stepOk = true;
        } else {
          // NEVER retry buy: if it actually landed on-chain but confirmation
          // timed out, a retry would double-buy. Abort the cycle and let the
          // 1-min cooldown restart cleanly.
          if (mayHaveBroadcast(steps)) {
            steps.push({
              step: "buy_confirmation_unknown",
              ok: true,
              info: "buy tx was broadcast but confirmation timed out; advancing to LP instead of retrying a possible landed buy",
            });
            nextState.phase = "lp";
            nextState.attempts = 0;
            stepOk = true;
          } else {
            steps.push({
              step: "buy",
              ok: false,
              error: "buy failed before broadcast — cooldown restarted to avoid duplicate buys",
            });
            nextState = abortCycleState();
            done = true;
          }
        }
        break;
      }

      case "lp": {
        // Same protection for LP: pre-advance to burn so a timeout can never
        // deposit the same wallet balance twice.
        await persistCycleProgress({ ...nextState, phase: "burn", attempts: 0 });
        const r = await stepLp(conn, signer, mint, tokenDecimals, nextState.spotPrice);
        steps = r.results;
        if (r.ok) {
          nextState.phase = "burn";
          nextState.attempts = 0;
          stepOk = true;
        } else {
          nextState.attempts++;
        }
        break;
      }
      case "burn": {
        // Pre-commit the post-cycle cooldown BEFORE broadcasting. If burn lands
        // but confirmation times out, the cooldown is already persisted so the
        // next tick idles instead of re-burning / re-claiming.
        await persistCycleProgress({
          ...nextState,
          cooldownUntilMs: Date.now() + CYCLE_INTERVAL_SEC * 1000,
        });

        const r = await stepBurn(conn, signer, mint);
        steps = r.results;
        if (r.ok) {
          nextState = resetCycleAfterBurnState();
          done = true;
          stepOk = true;
        } else if (mayHaveBroadcast(steps)) {
          // Burn likely landed; do NOT retry (would just fail on 0 balance and
          // spin). End the cycle on the cooldown we already persisted.
          steps.push({
            step: "burn_confirmation_unknown",
            ok: true,
            info: "burn tx broadcast but confirmation timed out; ending cycle on cooldown",
          });
          nextState = resetCycleAfterBurnState();
          done = true;
          stepOk = true;
        } else {
          nextState.attempts++;
        }
        break;
      }
    }
  } catch (e) {
    steps.push({ step: currentPhase, ok: false, error: (e as Error).message });
    nextState.attempts++;
  }

  // Safety: stop spinning on a step that keeps failing.
  if (!stepOk && nextState.attempts >= MAX_STEP_ATTEMPTS) {
    steps.push({
      step: currentPhase,
      ok: false,
      error: `step "${currentPhase}" failed ${nextState.attempts}x — aborting cycle`,
    });
    nextState = abortCycleState();
    done = true;
  }

  return { ok: stepOk, phase: currentPhase, done, steps, state: nextState };
}

/**
 * Locked full-cycle runner for internal/manual use. The public legacy route no
 * longer calls this; the live timer advances with tick() one locked step at a
 * time to avoid serverless timeouts.
 */
export async function runCycle(): Promise<{ ok: boolean; steps: StepResult[] }> {
  if (process.env.BOT_ENABLED !== "true") {
    return { ok: false, ran: false, reason: "disabled", steps: [], phase: "idle", secondsUntilNext: 0 } as any;
  }

  await ensureCycleStateRow();
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let state = await acquireCycleLease(owner);
  if (!state) {
    return { ok: true, steps: [{ step: "skip", ok: true, info: "locked" }] };
  }

  const steps: StepResult[] = [];
  let ok = true;
  let done = false;
  const maxIterations = 6;

  try {
    for (let i = 0; i < maxIterations; i++) {
      const result = await runCycleStep(state);
      steps.push(...result.steps);
      ok = ok && result.ok;
      state = result.state;
      done = result.done;

      await persistCycleProgress(state);

      if (done) break;
    }

    if (!done) {
      steps.push({
        step: "safety_cap",
        ok: false,
        error: `cycle exceeded ${maxIterations} step iterations — aborting to cooldown`,
      });
      ok = false;
      state = abortCycleState();
    }

    await persistCycleState(state);
    return { ok, steps };
  } catch (e) {
    steps.push({ step: "cycle", ok: false, error: (e as Error).message });
    await persistCycleState(abortCycleState());
    return { ok: false, steps };
  }
}

/**
 * Best-effort spot price (USDC per token) from the canonical PumpSwap pool, used
 * only to seed a brand-new bot-owned pool near market. Returns 0 if unavailable.
 */
async function fetchAmmSpotPrice(conn: Connection, mint: string): Promise<number> {
  try {
    const mintPk = new PublicKey(mint);
    const usdcPk = new PublicKey(USDC_MINT);
    const poolPk = canonicalPumpPoolPda(mintPk, usdcPk);
    const sdk = new OnlinePumpAmmSdk(conn);
    const pool = await sdk.fetchPool(poolPk);
    const [baseBal, quoteBal] = await Promise.all([
      conn.getTokenAccountBalance(pool.poolBaseTokenAccount).catch(() => null),
      conn.getTokenAccountBalance(pool.poolQuoteTokenAccount).catch(() => null),
    ]);
    const base = baseBal?.value.uiAmount ?? 0;
    const quote = quoteBal?.value.uiAmount ?? 0;
    return base > 0 ? quote / base : 0;
  } catch {
    return 0;
  }
}

/* ============================================================================
 * TICK — one-step public entry. GET status routes never call this. The website
 * only POSTs when the server-reported timer hits zero or a cycle is already in
 * progress, so a full cycle advances claim → buy → LP → burn without one long
 * request and without random read-only polls signing transactions.
 * ========================================================================== */

let inFlight: Promise<{
  ok: boolean;
  phase: Phase;
  done: boolean;
  steps: StepResult[];
  state: CycleState;
}> | null = null;
let lastKnownPhase: Phase | "idle" = "idle";

export type TickResult =
  | {
      ran: true;
      ok: boolean;
      phase: Phase;
      done: boolean;
      nextPhase: Phase | "idle";
      steps: StepResult[];
      secondsUntilNext: number;
      lastCycleAt?: number | null;
    }
  | {
      ran: false;
      reason: "cooldown" | "in_flight";
      phase: Phase | "idle";
      secondsUntilNext: number;
      lastCycleAt?: number | null;
    };

export type TickStatus = Extract<TickResult, { ran: false }>;

export async function cycleStatus(): Promise<TickStatus> {
  const now = Date.now();
  const state = (await readCycleState()) ?? (await ensureCycleStateRow());
  const active = state.cycleStartMs > 0 && now - state.cycleStartMs <= STALE_CYCLE_MS;
  const signer = loadKeypair();
  const conn = new Connection(rpcUrl(), "confirmed");
  const lastSigSec = await readLastCycleTsSec(conn, signer.publicKey);
  const lastCycleAt = typeof lastSigSec === "number" ? lastSigSec : null;
  const secondsUntilNext = Math.max(0, Math.ceil((state.cooldownUntilMs - now) / 1000));

  if (active) {
    return { ran: false, reason: "in_flight", phase: state.phase, secondsUntilNext, lastCycleAt };
  }
  return { ran: false, reason: "cooldown", phase: "idle", secondsUntilNext, lastCycleAt };
}

export async function readCycleStatus(): Promise<TickStatus> {
  return cycleStatus();
}

export async function tick(): Promise<TickResult> {
  if (process.env.BOT_ENABLED !== "true") {
    return { ok: false, ran: false, reason: "disabled", steps: [], phase: "idle", secondsUntilNext: 0 } as any;
  }
  const now = Date.now();
  if (inFlight) {
    return { ran: false, reason: "in_flight", phase: lastKnownPhase, secondsUntilNext: 3, lastCycleAt: null };
  }

  const owner = `${now}-${Math.random().toString(36).slice(2)}`;
  let leasedState = await acquireCycleLease(owner);
  if (!leasedState) {
    const locked = (await readCycleState()) ?? (await ensureCycleStateRow());
    lastKnownPhase = locked.cycleStartMs > 0 ? locked.phase : "idle";
    const secondsUntilNext = Math.max(0, Math.ceil((locked.cooldownUntilMs - now) / 1000));
    return { ran: false, reason: locked.cycleStartMs > 0 ? "in_flight" : "cooldown", phase: lastKnownPhase, secondsUntilNext };
  }

  const atStartOfCycle = leasedState.phase === "claim" && leasedState.claimedUsdc <= 0 && leasedState.attempts === 0;

  if (atStartOfCycle) {
    const signer = loadKeypair();
    const conn = new Connection(rpcUrl(), "confirmed");
    const chainCooldown = await walletCooldownState(conn, signer.publicKey, now);
    if (chainCooldown) {
      await persistCycleState(chainCooldown);
      lastKnownPhase = "idle";
      return {
        ran: false,
        reason: "cooldown",
        phase: "idle",
        secondsUntilNext: Math.max(1, Math.ceil((chainCooldown.cooldownUntilMs - now) / 1000)),
      };
    }

    // If a previous worker died while still showing `claim`, never reclaim the
    // vault after the lease expires. Treat it as an ended/failed cycle and wait
    // for the next clean 60s boundary. Duplicate claim txs are worse than a
    // skipped minute.
    if (leasedState.cycleStartMs > 0 && now - leasedState.cycleStartMs > 10_000) {
      const reset = abortCycleState();
      await persistCycleState(reset);
      lastKnownPhase = "idle";
      return {
        ran: false,
        reason: "cooldown",
        phase: "idle",
        secondsUntilNext: Math.max(1, Math.ceil((reset.cooldownUntilMs - now) / 1000)),
      };
    }
  }

  if (!atStartOfCycle && now - leasedState.cycleStartMs > STALE_CYCLE_MS) {
    const reset = abortCycleState();
    await persistCycleState(reset);
    lastKnownPhase = "idle";
    return {
      ran: false,
      reason: "cooldown",
      phase: "idle",
      secondsUntilNext: Math.ceil((reset.cooldownUntilMs - now) / 1000),
    };
  }
  lastKnownPhase = leasedState.phase;
  inFlight = runCycleStep(leasedState);
  try {
    const r = await inFlight;
    await persistCycleState(r.state);
    const nextPhase: Phase | "idle" = r.done ? "idle" : r.state.phase;
    lastKnownPhase = nextPhase;
    const secondsUntilNext = r.done
      ? Math.max(1, Math.ceil((r.state.cooldownUntilMs - Date.now()) / 1000))
      : 0;
    return {
      ran: true,
      ok: r.ok,
      phase: r.phase,
      done: r.done,
      nextPhase,
      steps: r.steps,
      secondsUntilNext,
    };
  } finally {
    inFlight = null;
  }
}
