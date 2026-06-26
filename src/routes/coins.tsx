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
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3">
          <Link to="/launch" className="flex items-center gap-3">
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
                  <div className="aspect-square overflow-hidden rounded-md bg-secondary/40">
                    {img ? (
                      <img
                        src={img}
                        alt={c.name ?? c.symbol ?? c.mint}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-muted-foreground">
                        ?
                      </div>
                    )}
                  </div>
                  <div className="mt-2 truncate text-sm font-bold">
                    {c.name ?? c.symbol ?? "Unnamed"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${c.symbol ?? "—"}
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
