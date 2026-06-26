import { createServerFn } from "@tanstack/react-start";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

// Known program IDs we want to label nicely.
const PROGRAM_LABELS: Record<string, string> = {
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA": "PumpSwap LP",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "Pump.fun Claim",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter Swap",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB": "Jupiter Swap",
};

function loadPubkey(): string {
  const pk = process.env.DEV_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error("DEV_WALLET_PRIVATE_KEY missing");
  const kp = pk.trim().startsWith("[")
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pk)))
    : Keypair.fromSecretKey(bs58.decode(pk.trim()));
  return kp.publicKey.toBase58();
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
};

async function fetchDex(mint: string): Promise<DexStats> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (!r.ok) throw new Error(`${r.status}`);
    const j = (await r.json()) as { pairs?: Array<Record<string, unknown>> };
    const pairs = j.pairs ?? [];
    // Prefer PumpSwap USDC pair
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

async function fetchTxs(conn: Connection, wallet: string): Promise<WalletTx[]> {
  const sigs = await conn.getSignaturesForAddress(new PublicKey(wallet), { limit: 15 });
  // Parse top 8 to get a program label; cheaper than parsing all.
  const out: WalletTx[] = [];
  const toParse = sigs.slice(0, 8);
  const parsed = await Promise.all(
    toParse.map((s) =>
      conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null),
    ),
  );
  toParse.forEach((s, i) => {
    const tx = parsed[i];
    let label = "Tx";
    if (tx) {
      const ix = tx.transaction.message.instructions ?? [];
      for (const inst of ix) {
        const pid = (inst as { programId?: PublicKey }).programId?.toBase58();
        if (pid && PROGRAM_LABELS[pid]) {
          label = PROGRAM_LABELS[pid];
          break;
        }
      }
    }
    out.push({
      signature: s.signature,
      blockTime: s.blockTime ?? null,
      label,
      success: !s.err,
    });
  });
  // Add rest as plain Tx
  for (const s of sigs.slice(8)) {
    out.push({
      signature: s.signature,
      blockTime: s.blockTime ?? null,
      label: "Tx",
      success: !s.err,
    });
  }
  return out;
}

export const getStats = createServerFn({ method: "GET" }).handler(async (): Promise<StatsPayload> => {
  const mint = process.env.TOKEN_MINT_ADDRESS;
  if (!mint) throw new Error("TOKEN_MINT_ADDRESS missing");
  const devWallet = loadPubkey();
  const conn = new Connection(RPC_URL, "confirmed");

  const [dex, txs] = await Promise.all([fetchDex(mint), fetchTxs(conn, devWallet)]);
  return { mint, devWallet, dex, txs };
});
