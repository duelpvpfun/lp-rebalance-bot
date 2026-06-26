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

  const deadlineMs = Date.now() + 75_000; // ~75s before we give up
  let lastErr: unknown;
  while (Date.now() < deadlineMs) {
    try {
      const status = await conn.getSignatureStatus(sig, { searchTransactionHistory: false });
      const s = status?.value;
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
        if (s.err) throw new Error(`tx failed: ${JSON.stringify(s.err)}`);
        return sig;
      }
      // not yet — rebroadcast and wait
      await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `tx ${sig} did not confirm within 75s${lastErr ? `: ${(lastErr as Error).message}` : ""}`,
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

/**
 * Pre-graduation cycle:
 *   1) claim USDC creator fees from the bonding-curve creator vault (V2 — the
 *      quote-mint-aware claim PumpPortal does NOT build for USDC coins),
 *   2) buy 35% of the claimed USDC worth of token on the bonding curve, then
 *   3) add the bought token + the remaining USDC into our own PumpSwap pool
 *      (created on first run). The bonding curve has no LP, but a standalone
 *      PumpSwap pool can be created/seeded at any time — so liquidity grows
 *      every cycle even before graduation.
 */
async function runBondingCurveCycle(
  conn: Connection,
  signer: Keypair,
  mint: string,
  tokenDecimals: number,
  steps: StepResult[],
): Promise<{ ok: boolean; steps: StepResult[] }> {
  const pubkey = signer.publicKey.toBase58();
  const mintPk = new PublicKey(mint);
  const usdcPk = new PublicKey(USDC_MINT);
  const user = signer.publicKey;

  // The token may be Token-2022; USDC is always legacy SPL Token.
  const tokenProgram = await getMintTokenProgram(conn, mintPk);

  const pumpSdk = new PumpSdk();
  const onlinePumpSdk = new OnlinePumpSdk(conn);

  // The creator vault is keyed by the bonding curve's on-chain `creator`. Only
  // that wallet can claim the fees. Read it and verify the dev wallet matches.
  const bcInfo = await conn.getAccountInfo(bondingCurvePda(mintPk));
  const bondingCurve = bcInfo ? pumpSdk.decodeBondingCurveNullable(bcInfo) : null;
  if (!bondingCurve) {
    steps.push({ step: "claim", ok: false, error: "bonding curve account not found" });
    return { ok: false, steps };
  }
  const creator = bondingCurve.creator;
  if (!creator.equals(user)) {
    steps.push({
      step: "claim",
      ok: false,
      error:
        `dev wallet ${pubkey} is not the token creator ${creator.toBase58()} — ` +
        `creator rewards are paid to the creator wallet, so this wallet cannot claim them. ` +
        `Set DEV_WALLET_PRIVATE_KEY to the token's creator wallet.`,
    });
    return { ok: false, steps };
  }

  // STEP 1: claim USDC creator fees (quote-mint-aware V2 claim).
  const usdcBefore = await getTokenUiBalance(conn, pubkey, USDC_MINT);
  try {
    // Read the *USDC* creator-fee vault directly. (getCreatorVaultBalance*
    // reads the native/SOL vault, which is 0 for USDC-quoted coins — that's a
    // display-only quirk; the V2 claim below still targets the right ATA.)
    const creatorVaultAuthority = creatorVaultPda(creator);
    const creatorVaultUsdcAta = getAssociatedTokenAddressSync(
      usdcPk,
      creatorVaultAuthority,
      true,
      TOKEN_PROGRAM_ID,
    );
    const claimableUsdc = await getTokenAccountUiBalance(conn, creatorVaultUsdcAta);
    steps.push({
      step: "claimable_usdc_vault",
      ok: true,
      info: { usdc: claimableUsdc, vault: creatorVaultUsdcAta.toBase58() },
    });

    if (claimableUsdc < 0.000001) {
      steps.push({
        step: "skip",
        ok: true,
        info: "no USDC creator rewards in bonding-curve vault",
      });
      return { ok: true, steps };
    }

    const claimIxs = await onlinePumpSdk.collectCoinCreatorFeeV2Instructions(
      creator,
      usdcPk,
      TOKEN_PROGRAM_ID,
      user,
    );
    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor((PRIORITY_FEE_SOL * 1e9 * 1e6) / 250_000),
      }),
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

  // STEP 2: buy 35% of the claimed USDC worth of token on the bonding curve.
  // (The other 65% stays as USDC to pair into the LP in STEP 3.)
  const buybackUsdcUi = claimedUsdc * BUYBACK_PCT;
  const spendUsdcRaw = new BN(Math.floor(buybackUsdcUi * 1e6).toString());
  let spotPriceUsdcPerToken = 0;
  try {
    const global = await onlinePumpSdk.fetchGlobal();
    const feeConfig = await onlinePumpSdk.fetchFeeConfig().catch(() => null);
    const buyState = await onlinePumpSdk.fetchBuyState(mintPk, user, tokenProgram);
    const mintSupply = bondingCurve.tokenTotalSupply ?? null;

    // Spot price for seeding our own pool (USDC per token, from virtual reserves).
    const vToken = Number(bondingCurve.virtualTokenReserves.toString()) / 10 ** tokenDecimals;
    const vUsdc = Number(bondingCurve.virtualQuoteReserves.toString()) / 1e6;
    spotPriceUsdcPerToken = vToken > 0 ? vUsdc / vToken : 0;

    // Estimate how many tokens `spendUsdcRaw` USDC buys at the current curve.
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

    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 350_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor((PRIORITY_FEE_SOL * 1e9 * 1e6) / 350_000),
      }),
      ...buyIxs,
    ];
    const sig = await sendInstructions(conn, signer, ixs);
    steps.push({
      step: "swap",
      ok: true,
      signature: sig,
      info: {
        spentUsdc: buybackUsdcUi,
        estTokens: Number(expectedTokens.toString()) / 10 ** tokenDecimals,
        venue: "bonding_curve",
      },
    });
  } catch (e) {
    steps.push({ step: "swap", ok: false, error: (e as Error).message });
    return { ok: false, steps };
  }

  await new Promise((r) => setTimeout(r, 4000));

  // STEP 3: add the bought token + remaining USDC into our own PumpSwap pool.
  const lpOk = await addToOwnPool(conn, signer, mint, tokenDecimals, spotPriceUsdcPerToken, steps);

  // STEP 4: burn the LP tokens we just received so the liquidity is locked forever.
  if (lpOk) {
    await new Promise((r) => setTimeout(r, 4000));
    await burnLpTokens(conn, signer, mint, steps);
  }
  return { ok: steps.every((s) => s.ok || s.step.startsWith("addLiquidity_retry")), steps };
}

export async function runCycle(): Promise<{ ok: boolean; steps: StepResult[] }> {
  const steps: StepResult[] = [];
  const mint = process.env.TOKEN_MINT_ADDRESS;
  if (!mint) throw new Error("TOKEN_MINT_ADDRESS missing");

  const signer = loadKeypair();
  const pubkey = signer.publicKey.toBase58();
  const conn = new Connection(rpcUrl(), "confirmed");
  const tokenDecimals = await getTokenDecimals(conn, mint);
  // Decide which venue we're on. Before a pump.fun coin graduates there is NO
  // PumpSwap pool — the bonding curve itself is the liquidity. All the
  // PumpSwap-based steps below would throw. So we check the bonding curve's
  // `complete` flag and run the curve-phase cycle (claim USDC fees -> buy on
  // the curve) until it graduates, then switch to the AMM cycle (claim -> buy
  // -> add LP) automatically.
  try {
    const pumpSdk = new PumpSdk();
    const bcInfo = await conn.getAccountInfo(bondingCurvePda(new PublicKey(mint)));
    const bondingCurve = bcInfo ? pumpSdk.decodeBondingCurveNullable(bcInfo) : null;
    if (bondingCurve && !bondingCurve.complete) {
      steps.push({
        step: "phase",
        ok: true,
        info: {
          phase: "bonding_curve",
          note: "token not graduated yet — claiming fees and buying on the curve to push toward graduation",
        },
      });
      return await runBondingCurveCycle(conn, signer, mint, tokenDecimals, steps);
    }
    steps.push({ step: "phase", ok: true, info: { phase: "amm" } });
  } catch (e) {
    // If the curve probe fails, fall through to the AMM path (best effort).
    steps.push({ step: "phase_probe", ok: false, error: (e as Error).message });
  }
  // STEP 1: claim PumpSwap USDC creator fees directly with the official SDK.
  // PumpPortal's collectCreatorFee path was building/claiming the old WSOL vault,
  // which produced successful-looking txs but 0 USDC claimed for this USDC pair.
  //
  // The creator-fee vault is derived from the pool's on-chain `coinCreator`,
  // NOT from whoever signs the tx. We read the canonical pool and use that
  // value, so the claim always targets the right vault. If the dev wallet is
  // not the registered creator, the claimed USDC would land in someone else's
  // ATA — we detect that and fail loudly instead of silently claiming 0.
  const usdcBefore = await getTokenUiBalance(conn, pubkey, USDC_MINT);
  try {
    const offlineSdk = new PumpAmmSdk();
    const onlineSdk = new OnlinePumpAmmSdk(conn);
    const quoteMint = new PublicKey(USDC_MINT);
    const quoteTokenProgram = TOKEN_PROGRAM_ID;

    const poolPk = canonicalPumpPoolPda(new PublicKey(mint), quoteMint);
    const pool = await onlineSdk.fetchPool(poolPk);
    const coinCreator = pool.coinCreator;

    if (!coinCreator.equals(signer.publicKey)) {
      throw new Error(
        `dev wallet ${pubkey} is not the pool coinCreator ${coinCreator.toBase58()} — ` +
          `creator rewards are paid to the creator wallet, so this wallet cannot claim them. ` +
          `Set DEV_WALLET_PRIVATE_KEY to the token's creator wallet.`,
      );
    }

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

  // STEP 2: buy back token with 35% of the claimed USDC, directly on the
  // canonical PumpSwap pool (same pool we LP into). Using the PumpSwap SDK
  // keeps the whole cycle on a single venue with no third-party aggregator.
  const buybackUsdcUi = claimedUsdc * BUYBACK_PCT;
  const buybackUsdcRaw = Math.floor(buybackUsdcUi * 1e6);
  try {
    const mintPk = new PublicKey(mint);
    const usdcPk = new PublicKey(USDC_MINT);
    const userPk = signer.publicKey;

    const poolPk = canonicalPumpPoolPda(mintPk, usdcPk);
    const onlineSdk = new OnlinePumpAmmSdk(conn);
    const offlineSdk = new PumpAmmSdk();
    const swapState = await onlineSdk.swapSolanaState(poolPk, userPk);

    if (!swapState.pool.baseMint.equals(mintPk)) {
      throw new Error(
        `pool base mint mismatch: pool.base=${swapState.pool.baseMint.toBase58()} expected=${mint}`,
      );
    }

    // quote (USDC) in -> base (token) out, with slippage tolerance.
    const buyIxs: TransactionInstruction[] = await offlineSdk.buyQuoteInput(
      swapState,
      new BN(buybackUsdcRaw.toString()),
      SLIPPAGE_BPS / 100,
    );

    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 350_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: Math.floor((PRIORITY_FEE_SOL * 1e9 * 1e6) / 350_000),
      }),
      ...buyIxs,
    ];

    const sig = await sendInstructions(conn, signer, ixs);
    steps.push({ step: "swap", ok: true, signature: sig, info: { spentUsdc: buybackUsdcUi } });
  } catch (e) {
    steps.push({ step: "swap", ok: false, error: (e as Error).message });
    return { ok: false, steps };
  }

  await new Promise((r) => setTimeout(r, 4000));

  // STEP 3: add the bought token + remaining USDC into our own PumpSwap pool
  // (created on first run, reused thereafter). Post-bond we use the live AMM
  // price as the seed price; if the pool already exists the seed price is
  // ignored and the deposit follows the pool's current ratio.
  let spotPrice = 0;
  try {
    const dexPrice = await fetchAmmSpotPrice(conn, mint);
    spotPrice = dexPrice;
  } catch {
    spotPrice = 0;
  }
  const ok = await addToOwnPool(conn, signer, mint, tokenDecimals, spotPrice, steps);

  // STEP 4: burn the LP tokens we just received so the liquidity is locked forever.
  if (ok) {
    await new Promise((r) => setTimeout(r, 4000));
    await burnLpTokens(conn, signer, mint, steps);
  }
  return { ok, steps };
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
        conn
          .getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
          .catch(() => null),
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
          console.log(`[scheduler] cycle ran ok=${r.ok} steps=${okSteps}/${r.steps.length}`);
        }
      })
      .catch((e) => console.error("[scheduler] tick failed:", (e as Error).message));
  };

  // Kick once shortly after boot, then on a fixed interval. We intentionally do
  // NOT unref() the timer — we WANT it to keep the process alive so the cycle
  // runs 24/7 on its own, every CYCLE_INTERVAL_SEC, with no browser tab or
  // external cron. (The website /api/public/tick poll remains a backup that
  // also fires the cooldown-gated cycle if the host ever recycles the process.)
  setTimeout(fire, 3000);
  setInterval(fire, CYCLE_INTERVAL_SEC * 1000);

  console.log(`[scheduler] started — firing every ${CYCLE_INTERVAL_SEC}s (24/7)`);
}
