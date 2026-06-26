import { createFileRoute } from "@tanstack/react-router";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Liquititty auto-cycle endpoint.
 *
 * Steps:
 *  1. Claim creator rewards (SOL) via PumpPortal local API
 *  2. Jupiter: swap 35% of the SOL gained → $TITTY
 *  3. Add 100% of bought $TITTY + remaining SOL into PumpSwap LP via PumpPortal
 *
 * NOTE on payout currency: pump.fun creator rewards pay in SOL, not USDC.
 * The buyback + LP pair is therefore SOL/TOKEN on PumpSwap.
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>` header.
 * Configure an external cron (cron-job.org, GitHub Actions, etc.) to POST every N minutes.
 */

const RPC_URL = "https://api.mainnet-beta.solana.com";
const PUMPPORTAL_LOCAL = "https://pumpportal.fun/api/trade-local";
const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP = "https://quote-api.jup.ag/v6/swap";
const SOL_MINT = "So11111111111111111111111111111111111111112";

const BUYBACK_PCT = 0.35;
const PRIORITY_FEE_SOL = 0.0005;
const SLIPPAGE_BPS = 1500; // 15% — memecoin volatility buffer
const POOL_SLIPPAGE_PCT = 10;

type StepResult = { step: string; ok: boolean; signature?: string; info?: unknown; error?: string };

function loadKeypair(): Keypair {
  const pk = process.env.DEV_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error("DEV_WALLET_PRIVATE_KEY missing");
  // Accept base58 or JSON array
  if (pk.trim().startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pk)));
  }
  return Keypair.fromSecretKey(bs58.decode(pk.trim()));
}

async function signAndSend(
  conn: Connection,
  signer: Keypair,
  txBytes: ArrayBuffer,
): Promise<string> {
  const tx = VersionedTransaction.deserialize(new Uint8Array(txBytes));
  tx.sign([signer]);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
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
  if (!res.ok) {
    throw new Error(`PumpPortal ${res.status}: ${await res.text()}`);
  }
  return res.arrayBuffer();
}

async function getSolBalance(conn: Connection, pubkey: string): Promise<number> {
  const lamports = await conn.getBalance({ toBase58: () => pubkey } as never).catch(async () => {
    const { PublicKey } = await import("@solana/web3.js");
    return conn.getBalance(new PublicKey(pubkey));
  });
  return lamports / 1e9;
}

async function getTokenBalance(conn: Connection, owner: string, mint: string): Promise<number> {
  const { PublicKey } = await import("@solana/web3.js");
  const accounts = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), {
    mint: new PublicKey(mint),
  });
  let total = 0;
  for (const a of accounts.value) {
    total += Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0);
  }
  return total;
}

async function runCycle(): Promise<{ ok: boolean; steps: StepResult[] }> {
  const steps: StepResult[] = [];
  const mint = process.env.TOKEN_MINT_ADDRESS;
  if (!mint) throw new Error("TOKEN_MINT_ADDRESS missing");

  const signer = loadKeypair();
  const pubkey = signer.publicKey.toBase58();
  const conn = new Connection(RPC_URL, "confirmed");

  // --- STEP 1: claim creator rewards ---
  const solBefore = await getSolBalance(conn, pubkey);
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

  // Wait a beat for balance to settle
  await new Promise((r) => setTimeout(r, 4000));
  const solAfter = await getSolBalance(conn, pubkey);
  const claimed = Math.max(0, solAfter - solBefore);
  steps.push({ step: "claimed_amount", ok: true, info: { sol: claimed } });

  if (claimed < 0.001) {
    steps.push({ step: "skip", ok: true, info: "claimed too small, aborting cycle" });
    return { ok: true, steps };
  }

  const buybackSol = claimed * BUYBACK_PCT;
  const buybackLamports = Math.floor(buybackSol * 1e9);

  // --- STEP 2: Jupiter swap SOL → token ---
  try {
    const quoteUrl =
      `${JUPITER_QUOTE}?inputMint=${SOL_MINT}&outputMint=${mint}` +
      `&amount=${buybackLamports}&slippageBps=${SLIPPAGE_BPS}`;
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
    steps.push({ step: "swap", ok: true, signature: sig, info: { spentSol: buybackSol } });
  } catch (e) {
    steps.push({ step: "swap", ok: false, error: (e as Error).message });
    return { ok: false, steps };
  }

  await new Promise((r) => setTimeout(r, 4000));

  // --- STEP 3: add liquidity on PumpSwap ---
  // PumpPortal exposes the "depositLiquidity" action for PumpSwap pools.
  // We pair 100% of the bought token with the remaining SOL.
  try {
    const tokenAmt = await getTokenBalance(conn, pubkey, mint);
    if (tokenAmt <= 0) throw new Error("no token balance to LP");

    const txBuf = await pumpPortalLocal({
      publicKey: pubkey,
      action: "depositLiquidity",
      mint,
      amount: tokenAmt,
      denominatedInSol: "false",
      slippage: POOL_SLIPPAGE_PCT,
      priorityFee: PRIORITY_FEE_SOL,
      pool: "pump-amm",
    });
    const sig = await signAndSend(conn, signer, txBuf);
    steps.push({ step: "addLiquidity", ok: true, signature: sig, info: { tokenAmount: tokenAmt } });
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
          return Response.json(
            { ok: false, error: (e as Error).message },
            { status: 500 },
          );
        }
      },
      GET: async () =>
        new Response("POST with Bearer CRON_SECRET to run the auto-LP cycle.", {
          status: 200,
        }),
    },
  },
});
