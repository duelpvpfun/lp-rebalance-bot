import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Rocket, ExternalLink } from "lucide-react";
import logo from "@/assets/liquititty-logo.webp";
import { WORKER_BASE_PUBLIC } from "@/lib/launch-client";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

const COMMUNITY_URL = "https://x.com/i/communities/2033361508042780851";

type Activity = {
  step?: string;
  ok?: boolean;
  amount_usdc?: number;
  amount_sol?: number;
  signature?: string;
  created_at?: string;
};
type Coin = {
  mint: string;
  name?: string;
  symbol?: string;
  description?: string;
  image_url?: string;
  imageUrl?: string;
  website_url?: string;
  twitter_url?: string;
  telegram_url?: string;
  pair_address?: string;
  market_cap_usd?: number;
  liquidity_usd?: number;
  liquidity_usdc?: number;
  liquidity_token?: number;
};
type Stats = {
  price_usd?: number | null;
  market_cap_usd?: number | null;
  liquidity_usd?: number | null;
  liquidity_usdc?: number | null;
  liquidity_token?: number | null;
  venue?: string | null;
} | null;

export const Route = createFileRoute("/coin/$mint")({
  component: CoinPage,
});

function fmtNum(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  if (a >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
const fmtUsd = (n?: number | null) =>
  n == null || !Number.isFinite(n) ? "—" : `$${fmtNum(n)}`;

function CoinPage() {
  const { mint } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["coin", mint],
    queryFn: async () => {
      const r = await fetch(
        `${WORKER_BASE_PUBLIC}/coin?id=${encodeURIComponent(mint)}`,
      );
      if (!r.ok) throw new Error("Failed");
      return (await r.json()) as { coin: Coin; stats: Stats; activity: Activity[] };
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const coin = data?.coin;
  const stats = data?.stats ?? null;

  const activity = (data?.activity ?? []).slice().sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });

  const img = coin?.image_url ?? coin?.imageUrl;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3">
          <Link to="/coins" className="flex items-center gap-3">
            <img src={logo} alt="liquititty" className="h-8 w-8 rounded-md" />
            <span className="font-display text-lg">liquititty / coins</span>
          </Link>
          <div className="flex items-center gap-2">
            <a
              href={COMMUNITY_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent"
            >
              <Users className="h-3 w-3" /> community
            </a>
            <ConnectWalletButton />
            <Link
              to="/launch"
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wider text-accent-foreground"
            >
              <Rocket className="h-3.5 w-3.5" />
              launch
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8">
        {isLoading && (
          <div className="py-20 text-center text-muted-foreground">loading…</div>
        )}
        {error && (
          <div className="py-20 text-center text-destructive">
            couldn't load coin
          </div>
        )}

        {coin && (
          <>
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-secondary/40 ring-1 ring-border">
                {img ? (
                  <img src={img} alt={coin.name} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate font-display text-2xl">{coin.name ?? "Unnamed"}</h1>
                  <span className="text-sm text-muted-foreground">
                    ${coin.symbol ?? "—"}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  CA: {coin.mint}
                </div>
                {coin.description && (
                  <p className="mt-2 text-sm text-muted-foreground">{coin.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {coin.website_url && (
                    <a className="pf-link" href={coin.website_url} target="_blank" rel="noreferrer">website ↗</a>
                  )}
                  {coin.twitter_url && (
                    <a className="pf-link" href={coin.twitter_url} target="_blank" rel="noreferrer">x/twitter ↗</a>
                  )}
                  {coin.telegram_url && (
                    <a className="pf-link" href={coin.telegram_url} target="_blank" rel="noreferrer">telegram ↗</a>
                  )}
                  <a
                    className="pf-link"
                    href={`https://solscan.io/token/${coin.mint}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    solscan ↗
                  </a>
                </div>
              </div>
            </div>

            {/* stats block — same vibe as the home stats header */}
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Market cap" value={fmtUsd(stats?.market_cap_usd)} />
              <Stat label="Liquidity" value={fmtUsd(stats?.liquidity_usd)} />
              <Stat label="USDC in LP" value={fmtNum(stats?.liquidity_usdc)} />
              <Stat label={`$${coin.symbol ?? "TOKEN"} in LP`} value={fmtNum(stats?.liquidity_token)} />
            </div>


            {/* dexscreener chart */}
            <div className="mt-6 overflow-hidden rounded-md border border-border bg-card/30">
              {coin.pair_address ? (
                <iframe
                  title="chart"
                  src={`https://dexscreener.com/solana/${coin.pair_address}?embed=1&theme=dark`}
                  className="block h-[520px] w-full"
                />
              ) : (
                <div className="grid h-[260px] place-items-center px-6 text-center text-sm text-muted-foreground">
                  chart available once trading starts
                </div>
              )}
            </div>

            {/* activity */}
            <section className="mt-8">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-accent">
                Dev wallet activity
              </h2>
              <div className="overflow-hidden rounded-md border border-border">
                {activity.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    no cycle activity yet
                  </div>
                )}
                {activity.length > 0 && (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Step</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">USDC</th>
                        <th className="px-3 py-2">SOL</th>
                        <th className="px-3 py-2">When</th>
                        <th className="px-3 py-2">Tx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.map((a, i) => (
                        <tr key={(a.signature ?? "") + i} className="border-t border-border/60">
                          <td className="px-3 py-2 font-medium">{a.step ?? "—"}</td>
                          <td className="px-3 py-2">
                            <span
                              className={
                                a.ok
                                  ? "rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent"
                                  : "rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive"
                              }
                            >
                              {a.ok ? "ok" : "fail"}
                            </span>
                          </td>
                          <td className="px-3 py-2">{a.amount_usdc != null ? fmtNum(a.amount_usdc) : "—"}</td>
                          <td className="px-3 py-2">{a.amount_sol != null ? fmtNum(a.amount_sol) : "—"}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {a.created_at ? new Date(a.created_at).toLocaleString() : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {a.signature ? (
                              <a
                                href={`https://solscan.io/tx/${a.signature}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-accent hover:underline"
                              >
                                {a.signature.slice(0, 6)}… <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-bold text-foreground">{value}</div>
    </div>
  );
}
