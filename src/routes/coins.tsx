import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Rocket, Users } from "lucide-react";
import logo from "@/assets/liquititty-logo.webp";
import { WORKER_BASE_PUBLIC } from "@/lib/launch-client";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

const COMMUNITY_URL = "https://x.com/i/communities/2033361508042780851";

type Stats = {
  price_usd?: number | null;
  market_cap_usd?: number | null;
  liquidity_usd?: number | null;
  liquidity_usdc?: number | null;
  liquidity_token?: number | null;
  venue?: string | null;
} | null;

type Coin = {
  mint: string;
  name?: string;
  symbol?: string;
  image_url?: string;
  imageUrl?: string;
  pair_address?: string;
  stats?: Stats;
};

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


export const Route = createFileRoute("/coins")({
  head: () => ({
    meta: [
      { title: "All Coins — Liquititty Launchpad" },
      {
        name: "description",
        content: "Every coin launched on the Liquititty protocol.",
      },
    ],
  }),
  component: CoinsPage,
});

function CoinsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["all-coins"],
    queryFn: async () => {
      const r = await fetch(`${WORKER_BASE_PUBLIC}/coins`);
      if (!r.ok) throw new Error("Failed to load coins");
      const j = await r.json();
      const arr: Coin[] = Array.isArray(j) ? j : j.coins ?? [];
      return arr;
    },
    refetchInterval: 10_000,
    staleTime: 5_000,

  });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4">
          <Link to="/launch" className="flex min-w-0 shrink items-center gap-2 sm:gap-3">
            <img src={logo} alt="liquititty" className="h-8 w-8 shrink-0 rounded-md" />
            <span className="hidden truncate font-display text-lg sm:inline">liquititty / coins</span>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <a
              href={COMMUNITY_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent sm:inline-flex"
            >
              <Users className="h-3 w-3" /> community
            </a>
            <ConnectWalletButton />
            <Link
              to="/launch"
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-3 py-2 text-xs font-bold uppercase tracking-wider text-accent-foreground sm:px-4"
            >
              <Rocket className="h-3.5 w-3.5" />
              launch
            </Link>
          </div>
        </div>
      </header>


      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-10">
        <h1 className="font-display text-2xl">All launches</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every coin launched on the Liquititty protocol — each auto-refills its own LP.
        </p>

        {isLoading && (
          <div className="mt-10 text-center text-muted-foreground">loading…</div>
        )}
        {error && (
          <div className="mt-10 text-center text-destructive">
            couldn't load coins
          </div>
        )}

        {data && data.length === 0 && (
          <div className="mt-10 border border-dashed border-border bg-card/30 p-12 text-center text-sm">
            <p className="font-display text-xl">no launches yet</p>
            <p className="mt-2 text-muted-foreground">be the first to launch.</p>
            <Link to="/launch" className="mt-4 inline-block pf-link font-bold">
              launch a coin →
            </Link>
          </div>
        )}

        {data && data.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.map((c) => {
              const img = c.image_url ?? c.imageUrl;
              return (
                <Link
                  key={c.mint}
                  to="/coin/$mint"
                  params={{ mint: c.mint }}
                  className="group rounded-md border border-border bg-card/40 p-3 transition hover:border-accent"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-secondary/40">
                      {img ? (
                        <img
                          src={img}
                          alt={c.name ?? c.symbol ?? c.mint}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-muted-foreground">?</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{c.name ?? c.symbol ?? "Unnamed"}</div>
                      <div className="truncate text-xs text-muted-foreground">${c.symbol ?? "—"}</div>
                    </div>
                  </div>

                  {/* mini chart */}
                  <div className="mt-2 overflow-hidden rounded-md border border-border/60 bg-background/40">
                    <div className="relative h-32 w-full">
                      <iframe
                        title={`chart-${c.mint}`}
                        src={`https://dexscreener.com/solana/${c.pair_address ?? c.mint}?embed=1&theme=dark&info=0&trades=0&chartLeftToolbar=0&chartDefaultOnMobile=1&header=0`}
                        className="block h-full w-full"
                        loading="lazy"
                      />
                      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-black" />
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <div className="rounded border border-border/60 bg-background/40 px-1.5 py-1">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">MCap</div>
                      <div className="text-xs font-bold">{fmtUsd(c.stats?.market_cap_usd)}</div>
                    </div>
                    <div className="rounded border border-border/60 bg-background/40 px-1.5 py-1">
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Liq</div>
                      <div className="text-xs font-bold">{fmtUsd(c.stats?.liquidity_usd)}</div>
                    </div>
                  </div>

                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
