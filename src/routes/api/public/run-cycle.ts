import { createFileRoute } from "@tanstack/react-router";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Liquititty auto-cycle endpoint (USDC-quoted pump.fun coin).
 *
 * Steps:
 *  1. Claim creator rewards (USDC) via PumpPortal `collectCreatorFee`.
 *  2. Jupiter: swap BUYBACK_PCT of the newly claimed USDC into the token.
 *  3. Add LP on PumpSwap (TOKEN/USDC). Pair as much TOKEN + USDC as the
 *     current pool ratio allows, capped by the wallet's USDC balance.
 *     If the price moved up and we don't have enough USDC to pair 100% of
 *     bought tokens, we cap the token side to what the USDC can match and
 *     keep the leftover tokens for the next round.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`.
 */

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const PUMPPORTAL_LOCAL = "https://pumpportal.fun/api/trade-local";
const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP = "https://quote-api.jup.ag/v6/swap";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const BUYBACK_PCT = 0.35;
const PRIORITY_FEE_SOL = 0.0005;
const SLIPPAGE_BPS = 1500; // 15%
const POOL_SLIPPAGE_PCT = 10;
// safety margin so we don't get rejected at the edge of the pool ratio
const LP_SAFETY = 0.98;

type StepResult = { step: string; ok: boolean; signature?: string; info?: unknown; error?: string };

function loadKeypair(): Keypair {
  const pk = process.env.DEV_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error("DEV_WALLET_PRIVATE_KEY missing");
  if (pk.trim().startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pk)));
  }
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

/** Use Jupiter as oracle: how much USDC does `tokenUi` of TOKEN price at? */
async function priceTokenInUsdc(mint: string, tokenRawAmount: string): Promise<number> {
  const url =
    `${JUPITER_QUOTE}?inputMint=${mint}&outputMint=${USDC_MINT}` +
    `&amount=${tokenRawAmount}&slippageBps=50&swapMode=ExactIn`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Jupiter price ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return Number(j.outAmount); // raw USDC (6dp)
}

async function getTokenDecimals(conn: Connection, mint: string): Promise<number> {
  const info = await conn.getParsedAccountInfo(new PublicKey(mint));
  // @ts-expect-error parsed shape
  return info.value?.data?.parsed?.info?.decimals ?? 6;
}

async function runCycle(): Promise<{ ok: boolean; steps: StepResult[] }> {
  const steps: StepResult[] = [];
  const mint = process.env.TOKEN_MINT_ADDRESS;
  if (!mint) throw new Error("TOKEN_MINT_ADDRESS missing");

  const signer = loadKeypair();
  const pubkey = signer.publicKey.toBase58();
  const conn = new Connection(RPC_URL, "confirmed");

  const tokenDecimals = await getTokenDecimals(conn, mint);

  // --- STEP 1: claim creator rewards (USDC) ---
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

  // --- STEP 2: Jupiter swap USDC → token (BUYBACK_PCT of claimed) ---
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

  // --- STEP 3: add liquidity on PumpSwap (TOKEN/USDC) ---
  try {
    const tokenAvail = await getTokenUiBalance(conn, pubkey, mint);
    const usdcAvail = await getTokenUiBalance(conn, pubkey, USDC_MINT);
    if (tokenAvail <= 0) throw new Error("no token balance to LP");
    if (usdcAvail <= 0) throw new Error("no USDC balance to LP");

    // Price tokens via Jupiter to estimate the USDC needed at current pool ratio.
    const tokenRaw = BigInt(Math.floor(tokenAvail * 10 ** tokenDecimals)).toString();
    const usdcNeededRaw = await priceTokenInUsdc(mint, tokenRaw);
    const usdcNeededUi = usdcNeededRaw / 1e6;

    let depositTokenUi = tokenAvail;
    let note: string | undefined;
    if (usdcNeededUi > usdcAvail) {
      // Price pumped — cap tokens to what our USDC can match, leftover tokens
      // stay in the wallet for the next cycle.
      const ratio = (usdcAvail * LP_SAFETY) / usdcNeededUi;
      depositTokenUi = tokenAvail * ratio;
      note = `price pumped; LPing ${(ratio * 100).toFixed(2)}% of tokens, rest deferred`;
    }

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
      info: { tokenDeposited: depositTokenUi, usdcAvail, usdcNeededUi, note },
    });
  } catch (e) {
    steps.push({ step: "addLiquidity", ok: false, error: (e as Error).message });
    return { ok: false, steps };
  }

  return { ok: true, steps };
}

export const Route = createFileRoute("/api/public/run-cycle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
        if (!process.env.CRON_SECRET || auth !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await runCycle();
          return Response.json(result, { status: result.ok ? 200 : 500 });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
      GET: async () =>
        new Response("POST with Bearer CRON_SECRET to run the auto-LP cycle.", { status: 200 }),
    },
  },
});
