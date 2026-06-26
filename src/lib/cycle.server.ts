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
 * Shared between the cron route (/api/public/run-cycle) and the
 * built-in scheduler route (/api/public/tick).
 *
 * The whole cycle runs against the canonical PumpSwap pool via the official
 * SDK — claim, buyback and LP all use the same pool and the same USDC quote
 * token, so there is no dependency on any third-party swap aggregator.
 */

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const BUYBACK_PCT = 0.35;
const PRIORITY_FEE_SOL = 0.0005;
const SLIPPAGE_BPS = 1500;
const POOL_SLIPPAGE_PCT = 10;
const MAX_LP_RETRIES = 6;
const LP_SHRINK_FACTOR = 0.85;

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
    // ~0.0005 SOL on a 400k CU tx — fine for our small claim/buy/LP txs.
    prepend.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_250_000 }));
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

  // Send with skipPreflight + manual rebroadcast loop until the tx confirms
  // or the blockhash expires. This is the pattern Helius/Jito recommend for
  // landing txs reliably on mainnet.
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });

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
      const sig = await sendInstructions(conn, signer, ixs);
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
        const sig = await sendInstructions(conn, signer, ixs);
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
 * STEP-BASED CYCLE STATE MACHINE
 *
 * Serverless hosts (Cloudflare Workers, edge functions) kill requests after
 * ~30s. The old runCycle() did claim → buy → LP → burn in a single request and
 * ran 40–60s, so it got killed mid-flight and only the claim ever landed.
 *
 * Now each tick() call advances exactly ONE step of the current cycle. The
 * frontend (and the in-process scheduler) polls /api/public/tick every ~5s, so
 * a full cycle completes in ~4 ticks (~20s) regardless of host timeouts. The
 * order is fixed: claim → buy → lp → burn, then back to idle for the cooldown.
 *
 * A new cycle's claim only starts after the previous cycle's burn confirms.
 * State lives in this module — Workers reuse isolates so it survives across
 * ticks; if an isolate dies mid-cycle we reset to idle and the next tick
 * starts fresh.
 * ========================================================================== */

type Phase = "claim" | "buy" | "lp" | "burn";

const MAX_STEP_ATTEMPTS = 4;

let cycleState: {
  phase: Phase;
  cycleStartMs: number;
  lastBurnMs: number;
  claimedUsdc: number;
  spotPrice: number;
  attempts: number;
} = {
  phase: "claim",
  cycleStartMs: 0,
  lastBurnMs: 0,
  claimedUsdc: 0,
  spotPrice: 0,
  attempts: 0,
};

function resetCycleAfterBurn() {
  cycleState = {
    phase: "claim",
    cycleStartMs: 0,
    lastBurnMs: Date.now(),
    claimedUsdc: 0,
    spotPrice: 0,
    attempts: 0,
  };
}

function abortCycle() {
  // Same as post-burn reset but lastBurnMs unchanged so cooldown isn't extended
  // by a fail-fast. Skips (nothing to claim) and hard failures both come here.
  cycleState = {
    phase: "claim",
    cycleStartMs: 0,
    lastBurnMs: cycleState.lastBurnMs || Date.now(),
    claimedUsdc: 0,
    spotPrice: 0,
    attempts: 0,
  };
}

/* ----------------- STEP 1: claim USDC creator fees ----------------- */
async function stepClaim(
  conn: Connection,
  signer: Keypair,
  mint: string,
  tokenDecimals: number,
): Promise<{
  results: StepResult[];
  claimedUsdc: number;
  spotPriceUsdcPerToken: number;
  skip: boolean;
  ok: boolean;
}> {
  const out: StepResult[] = [];
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
        return { results: out, claimedUsdc: 0, spotPriceUsdcPerToken, skip: true, ok: false };
      }
      const creatorVaultAuthority = creatorVaultPda(creator);
      const creatorVaultUsdcAta = getAssociatedTokenAddressSync(
        usdcPk,
        creatorVaultAuthority,
        true,
        TOKEN_PROGRAM_ID,
      );
      const claimableUsdc = await getTokenAccountUiBalance(conn, creatorVaultUsdcAta);
      out.push({
        step: "claimable_usdc_vault",
        ok: true,
        info: { usdc: claimableUsdc, vault: creatorVaultUsdcAta.toBase58() },
      });
      if (claimableUsdc < 0.000001) {
        out.push({ step: "skip", ok: true, info: "no USDC creator rewards in bonding-curve vault" });
        return { results: out, claimedUsdc: 0, spotPriceUsdcPerToken, skip: true, ok: true };
      }
      const onlinePumpSdk = new OnlinePumpSdk(conn);
      const claimIxs = await onlinePumpSdk.collectCoinCreatorFeeV2Instructions(
        creator,
        usdcPk,
        TOKEN_PROGRAM_ID,
        user,
      );
      const sig = await sendInstructions(conn, signer, claimIxs);
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
        return { results: out, claimedUsdc: 0, spotPriceUsdcPerToken, skip: true, ok: false };
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
      out.push({
        step: "claimable_usdc_vault",
        ok: true,
        info: { usdc: vaultUsdc, vault: coinCreatorVaultAta.toBase58() },
      });
      if (vaultUsdc < 0.000001) {
        out.push({ step: "skip", ok: true, info: "no USDC creator rewards in PumpSwap vault" });
        return { results: out, claimedUsdc: 0, spotPriceUsdcPerToken, skip: true, ok: true };
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
      const sig = await sendInstructions(conn, signer, ixs);
      out.push({
        step: "claim",
        ok: true,
        signature: sig,
        info: { quoteMint: USDC_MINT, venue: "amm" },
      });
    }
  } catch (e) {
    out.push({ step: "claim", ok: false, error: (e as Error).message });
    return { results: out, claimedUsdc: 0, spotPriceUsdcPerToken, skip: false, ok: false };
  }

  // Claim confirmed → USDC is in our ATA. Compute the delta to size the buy.
  const usdcAfter = await getTokenUiBalance(conn, pubkey, USDC_MINT);
  const claimedUsdc = Math.max(0, usdcAfter - usdcBefore);
  out.push({ step: "claimed_amount", ok: true, info: { usdc: claimedUsdc } });
  return { results: out, claimedUsdc, spotPriceUsdcPerToken, skip: false, ok: true };
}

/* ----------------- STEP 2: buy 35% of claimed USDC into token ----------------- */
async function stepBuy(
  conn: Connection,
  signer: Keypair,
  mint: string,
  tokenDecimals: number,
  claimedUsdc: number,
): Promise<{ results: StepResult[]; ok: boolean; skip: boolean }> {
  const out: StepResult[] = [];
  if (claimedUsdc < 0.5) {
    out.push({ step: "skip", ok: true, info: "claimed USDC too small to buy" });
    return { results: out, ok: false, skip: true };
  }
  const buybackUsdcUi = claimedUsdc * BUYBACK_PCT;
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
      const sig = await sendInstructions(conn, signer, buyIxs);
      out.push({
        step: "swap",
        ok: true,
        signature: sig,
        info: {
          spentUsdc: buybackUsdcUi,
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
      const sig = await sendInstructions(conn, signer, buyIxs);
      out.push({
        step: "swap",
        ok: true,
        signature: sig,
        info: { spentUsdc: buybackUsdcUi, venue: "amm" },
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
): Promise<{ results: StepResult[]; ok: boolean }> {
  const out: StepResult[] = [];
  const ok = await addToOwnPool(conn, signer, mint, tokenDecimals, spotPriceUsdcPerToken, out);
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

/* ----------------- One-step driver (called by tick) ----------------- */
export async function runCycleStep(): Promise<{
  ok: boolean;
  phase: Phase;
  done: boolean;
  steps: StepResult[];
}> {
  const mint = process.env.TOKEN_MINT_ADDRESS;
  if (!mint) throw new Error("TOKEN_MINT_ADDRESS missing");
  const signer = loadKeypair();
  const conn = new Connection(rpcUrl(), "confirmed");
  const tokenDecimals = await getTokenDecimals(conn, mint);

  if (cycleState.cycleStartMs === 0) cycleState.cycleStartMs = Date.now();
  const currentPhase = cycleState.phase;
  let steps: StepResult[] = [];
  let stepOk = false;
  let done = false;

  try {
    switch (currentPhase) {
      case "claim": {
        const r = await stepClaim(conn, signer, mint, tokenDecimals);
        steps = r.results;
        if (r.skip) {
          abortCycle();
          done = true;
          stepOk = r.ok;
          break;
        }
        if (r.ok) {
          cycleState.claimedUsdc = r.claimedUsdc;
          cycleState.spotPrice = r.spotPriceUsdcPerToken;
          if (r.claimedUsdc < 0.5) {
            abortCycle();
            done = true;
          } else {
            cycleState.phase = "buy";
            cycleState.attempts = 0;
          }
          stepOk = true;
        } else {
          cycleState.attempts++;
        }
        break;
      }
      case "buy": {
        const r = await stepBuy(conn, signer, mint, tokenDecimals, cycleState.claimedUsdc);
        steps = r.results;
        if (r.skip) {
          // can't buy → still try to LP whatever we hold next tick.
          cycleState.phase = "lp";
          cycleState.attempts = 0;
          stepOk = true;
        } else if (r.ok) {
          cycleState.phase = "lp";
          cycleState.attempts = 0;
          stepOk = true;
        } else {
          cycleState.attempts++;
        }
        break;
      }
      case "lp": {
        const r = await stepLp(conn, signer, mint, tokenDecimals, cycleState.spotPrice);
        steps = r.results;
        if (r.ok) {
          cycleState.phase = "burn";
          cycleState.attempts = 0;
          stepOk = true;
        } else {
          cycleState.attempts++;
        }
        break;
      }
      case "burn": {
        const r = await stepBurn(conn, signer, mint);
        steps = r.results;
        if (r.ok) {
          resetCycleAfterBurn();
          done = true;
          stepOk = true;
        } else {
          cycleState.attempts++;
        }
        break;
      }
    }
  } catch (e) {
    steps.push({ step: currentPhase, ok: false, error: (e as Error).message });
    cycleState.attempts++;
  }

  // Safety: stop spinning on a step that keeps failing.
  if (!stepOk && cycleState.attempts >= MAX_STEP_ATTEMPTS) {
    steps.push({
      step: currentPhase,
      ok: false,
      error: `step "${currentPhase}" failed ${cycleState.attempts}x — aborting cycle`,
    });
    abortCycle();
    done = true;
  }

  return { ok: stepOk, phase: currentPhase, done, steps };
}

/**
 * Back-compat shim. The old monolithic runCycle is gone; callers that want a
 * whole cycle should call tick() repeatedly. This just runs one step.
 */
export async function runCycle(): Promise<{ ok: boolean; steps: StepResult[] }> {
  const r = await runCycleStep();
  return { ok: r.ok, steps: r.steps };
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
 * TICK — public entry. Runs at most one step per call.
 *   - "cooldown": idle, waiting for CYCLE_INTERVAL_SEC since last burn.
 *   - "in_flight": another tick is already running a step.
 *   - ran=true: a step executed; phase/done describe progress.
 * ========================================================================== */

let inFlight: Promise<{
  ok: boolean;
  phase: Phase;
  done: boolean;
  steps: StepResult[];
}> | null = null;

export type TickResult =
  | {
      ran: true;
      ok: boolean;
      phase: Phase;
      done: boolean;
      nextPhase: Phase | "idle";
      steps: StepResult[];
      secondsUntilNext: number;
    }
  | {
      ran: false;
      reason: "cooldown" | "in_flight";
      phase: Phase | "idle";
      secondsUntilNext: number;
    };

export async function tick(): Promise<TickResult> {
  const now = Date.now();
  if (inFlight) {
    return { ran: false, reason: "in_flight", phase: cycleState.phase, secondsUntilNext: 3 };
  }
  // Cooldown only gates the START of a new cycle. Mid-cycle ticks always run.
  const atStartOfCycle = cycleState.cycleStartMs === 0;
  if (atStartOfCycle && cycleState.lastBurnMs > 0) {
    const sinceBurnSec = (now - cycleState.lastBurnMs) / 1000;
    if (sinceBurnSec < CYCLE_INTERVAL_SEC) {
      return {
        ran: false,
        reason: "cooldown",
        phase: "idle",
        secondsUntilNext: Math.ceil(CYCLE_INTERVAL_SEC - sinceBurnSec),
      };
    }
  }

  inFlight = runCycleStep();
  try {
    const r = await inFlight;
    const nextPhase: Phase | "idle" = r.done ? "idle" : cycleState.phase;
    const secondsUntilNext = r.done ? CYCLE_INTERVAL_SEC : 4;
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


/**
 * Server-side scheduler. Starts a single setInterval (per server isolate) that
 * fires `tick()` every CYCLE_INTERVAL_SEC. tick() is itself cooldown-gated by
 * the on-chain timestamp + in-memory single-flight lock, so this is safe even
 * if multiple isolates each start their own timer.
 *
 * This removes the dependency on a browser tab / external cron pinging the
 * site — the cycle runs on its own as long as the server process is alive.
 */
let schedulerStarted = false;

export function ensureScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const fire = () => {
    tick()
      .then((r) => {
        if (r.ran) {
          const okSteps = r.steps.filter((s) => s.ok).length;
          console.log(
            `[scheduler] step=${r.phase} ok=${r.ok} done=${r.done} (${okSteps}/${r.steps.length} sub-steps)`,
          );
        }
      })
      .catch((e) => console.error("[scheduler] tick failed:", (e as Error).message));
  };

  // Fire frequently so the step machine progresses on its own (~one step per
  // 5s tick). Each step is short and the cooldown gate at the START of a new
  // cycle still enforces CYCLE_INTERVAL_SEC between full cycles.
  setTimeout(fire, 3000);
  setInterval(fire, 5_000);

  console.log("[scheduler] started — polling step machine every 5s");

}
