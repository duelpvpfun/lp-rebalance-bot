import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Users, Rocket, Search, TrendingUp, Flame, Sparkles, ArrowUpRight } from "lucide-react";
import logo from "@/assets/liquititty-logo.webp";

const COMMUNITY_URL = "https://x.com/i/communities/2033361508042780851";

export const Route = createFileRoute("/launch")({
  head: () => ({
    meta: [
      { title: "Launchpad — Liquititty" },
      {
        name: "description",
        content:
          "Launch self-refilling memecoins on Liquititty. Every coin auto-recycles creator fees back into its own LP — no rugs, no babysitting.",
      },
      { property: "og:title", content: "Liquititty Launchpad" },
      {
        property: "og:description",
        content: "Launch a coin that grows its own liquidity pool on autopilot.",
      },
    ],
  }),
  component: LaunchPage,
});

type MockCoin = {
  ticker: string;
  name: string;
  blurb: string;
  emoji: string;
  mcap: number;
  liq: number;
  changePct: number;
  ageMin: number;
  cycles: number;
  holders: number;
  hot?: boolean;
  king?: boolean;
};

const MOCK: MockCoin[] = [
  { ticker: "LIQUITITTY", name: "Liquititty", blurb: "the OG self-refilling memecoin.", emoji: "🍑", mcap: 842000, liq: 214000, changePct: 38.4, ageMin: 11, cycles: 1342, holders: 4811, king: true, hot: true },
  { ticker: "FATSTACK", name: "Fat Stack", blurb: "we eat the fees for breakfast.", emoji: "🥞", mcap: 184200, liq: 51200, changePct: 22.1, ageMin: 42, cycles: 612, holders: 1280, hot: true },
  { ticker: "JUGZ", name: "Jugz", blurb: "biggest jugs on solana.", emoji: "🍼", mcap: 96100, liq: 27800, changePct: 9.4, ageMin: 88, cycles: 411, holders: 822 },
  { ticker: "REFILL", name: "Refill Coin", blurb: "the pool only goes up.", emoji: "🧴", mcap: 71400, liq: 19500, changePct: -3.2, ageMin: 124, cycles: 287, holders: 519 },
  { ticker: "BOOBA", name: "Booba", blurb: "two bags. one mission.", emoji: "👯", mcap: 54320, liq: 14100, changePct: 14.7, ageMin: 198, cycles: 188, holders: 402, hot: true },
  { ticker: "DRIP", name: "Drip Drip", blurb: "fees go drip drip into LP.", emoji: "💧", mcap: 41200, liq: 11200, changePct: 6.8, ageMin: 240, cycles: 142, holders: 311 },
  { ticker: "MILKY", name: "Milky Way", blurb: "galactic liquidity.", emoji: "🌌", mcap: 28900, liq: 8200, changePct: -1.1, ageMin: 312, cycles: 91, holders: 244 },
  { ticker: "POOL", name: "Pool Party", blurb: "always 100% paired.", emoji: "🏊", mcap: 18450, liq: 5400, changePct: 4.4, ageMin: 480, cycles: 60, holders: 188 },
  { ticker: "BBAG", name: "Big Bag", blurb: "the only bag that refills.", emoji: "💰", mcap: 12300, liq: 3600, changePct: -8.9, ageMin: 612, cycles: 38, holders: 121 },
];

function fmtUsd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtAge(min: number) {
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

function Header() {
  return (
    <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
      <Link to="/" className="flex items-center gap-3">
        <img src={logo} alt="Liquititty logo" className="h-10 w-10 rounded-lg shadow-lg" />
        <span className="font-display text-xl">LIQUITITTY</span>
      </Link>
      <nav className="hidden gap-8 text-sm md:flex">
        <Link to="/" className="opacity-80 hover:opacity-100">Home</Link>
        <Link to="/launch" className="opacity-100 text-accent">Launchpad</Link>
        <a href="/#how" className="opacity-80 hover:opacity-100">How it works</a>
        <a href="/#faq" className="opacity-80 hover:opacity-100">FAQ</a>
      </nav>
      <div className="flex items-center gap-2">
        <a
          href={COMMUNITY_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Join the community"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary/40 transition hover:scale-110 hover:bg-secondary"
        >
          <Users className="h-4 w-4" />
        </a>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-bold text-accent-foreground shadow-[0_0_24px_-4px_var(--color-accent)] transition hover:scale-105"
        >
          <Rocket className="h-4 w-4" />
          Launch a coin
        </button>
      </div>
    </header>
  );
}

function LaunchPage() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"hot" | "new" | "mcap">("hot");

  const filtered = useMemo(() => {
    let arr = MOCK.filter(
      (c) =>
        c.ticker.toLowerCase().includes(query.toLowerCase()) ||
        c.name.toLowerCase().includes(query.toLowerCase()),
    );
    if (sort === "new") arr = [...arr].sort((a, b) => a.ageMin - b.ageMin);
    else if (sort === "mcap") arr = [...arr].sort((a, b) => b.mcap - a.mcap);
    else arr = [...arr].sort((a, b) => Number(b.hot ?? 0) - Number(a.hot ?? 0) || b.changePct - a.changePct);
    return arr;
  }, [query, sort]);

  const king = MOCK.find((c) => c.king) ?? MOCK[0];

  return (
    <div className="min-h-screen pb-24">
      <Header />

      {/* TICKER */}
      <div className="overflow-hidden border-y border-border/60 bg-secondary/30 py-2 text-xs">
        <div className="ticker-marquee flex w-max items-center gap-8 whitespace-nowrap px-6 font-mono uppercase tracking-widest">
          {[...MOCK, ...MOCK].map((c, i) => (
            <span key={i} className="flex items-center gap-2">
              <span>{c.emoji}</span>
              <span className="font-bold">${c.ticker}</span>
              <span className={c.changePct >= 0 ? "text-accent" : "text-destructive"}>
                {c.changePct >= 0 ? "+" : ""}
                {c.changePct.toFixed(1)}%
              </span>
              <span className="text-muted-foreground">·</span>
            </span>
          ))}
        </div>
      </div>

      {/* HERO */}
      <section className="mx-auto max-w-7xl px-6 pt-14 pb-10">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-4 py-1.5 text-xs uppercase tracking-widest backdrop-blur">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              Launchpad · USDC pair · Auto-LP built in
            </div>
            <h1 className="font-display text-5xl leading-[0.95] md:text-7xl">
              LAUNCH A COIN.<br />
              <span className="text-accent">IT REFILLS ITS OWN LP.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Every coin on Liquititty Launchpad runs the same loop the OG does: claim creator
              fees in USDC, buy 35% back, redeposit into PumpSwap. You ship a coin. The bot
              ships liquidity. Forever.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3 font-bold text-accent-foreground shadow-[0_0_32px_-4px_var(--color-accent)] transition hover:scale-105"
              >
                <Rocket className="h-5 w-5" />
                Launch a coin
              </button>
              <a
                href="#terminal"
                className="rounded-full border border-border px-6 py-3 font-semibold backdrop-blur transition hover:bg-secondary/40"
              >
                Browse live launches
              </a>
            </div>
            <div className="mt-8 grid max-w-md grid-cols-3 gap-3 text-xs">
              <Mini label="Live launches" value={MOCK.length.toString()} />
              <Mini label="LP cycles today" value="2,184" />
              <Mini label="USDC re-LP'd" value="$184k" />
            </div>
          </div>

          {/* KING CARD */}
          <KingCard king={king} />
        </div>
      </section>

      {/* TERMINAL */}
      <section id="terminal" className="mx-auto max-w-7xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 pb-3">
          <div className="flex items-center gap-3">
            <span className="font-display text-lg text-accent">TERMINAL</span>
            <span className="text-muted-foreground">·</span>
            <span className="rounded-full bg-secondary/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">
              {filtered.length} live
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SortPill icon={<Flame className="h-3.5 w-3.5" />} label="hot" active={sort === "hot"} onClick={() => setSort("hot")} />
            <SortPill icon={<Sparkles className="h-3.5 w-3.5" />} label="new" active={sort === "new"} onClick={() => setSort("new")} />
            <SortPill icon={<TrendingUp className="h-3.5 w-3.5" />} label="mcap" active={sort === "mcap"} onClick={() => setSort("mcap")} />
            <label className="ml-1 flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs">
              <Search className="h-3.5 w-3.5 opacity-70" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search ticker…"
                className="w-32 bg-transparent outline-none placeholder:text-muted-foreground/70"
              />
            </label>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <CoinCard key={c.ticker} c={c} />
          ))}
          <LaunchCTA />
        </div>
      </section>

      {/* HOW IT WORKS STRIP */}
      <section className="mx-auto mt-20 max-w-7xl px-6">
        <div className="rounded-3xl border border-border bg-secondary/30 p-8 backdrop-blur md:p-12">
          <p className="text-xs uppercase tracking-widest text-accent">No babysitting required</p>
          <h2 className="mt-2 font-display text-3xl md:text-4xl">
            EVERY COIN ON THE PAD GETS THE SAME BOT.
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {[
              { n: "01", t: "Deploy", d: "Pick a name, upload art, ship. Token launches on pump.fun with USDC pair." },
              { n: "02", t: "Bot wakes up", d: "Auto-LP cycle runs every minute on the dev wallet. Forever." },
              { n: "03", t: "Claim → Buy → LP", d: "USDC creator fees become buybacks and LP. Liquidity only goes up." },
              { n: "04", t: "Burn LP", d: "LP tokens burn after deposit. Liquidity is permanent — not even the dev can pull it." },
            ].map((s) => (
              <div key={s.n} className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur">
                <div className="font-display text-2xl text-accent">{s.n}</div>
                <div className="mt-1 font-bold">{s.t}</div>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="mt-16 border-t border-border/50 py-10 text-center text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">← back to $LIQUITITTY</Link>
      </footer>

      <style>{`
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .ticker-marquee { animation: ticker 60s linear infinite; }
      `}</style>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/50 px-3 py-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-base">{value}</div>
    </div>
  );
}

function KingCard({ king }: { king: MockCoin }) {
  return (
    <div className="relative">
      <div className="absolute -inset-1 -z-10 rounded-3xl bg-accent/30 blur-2xl" />
      <div className="rounded-3xl border-2 border-accent/60 bg-card/80 p-6 backdrop-blur">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest">
          <span className="rounded-full bg-accent px-2 py-0.5 font-bold text-accent-foreground">
            👑 King of the pad
          </span>
          <span className="text-accent">live · auto-LP on</span>
        </div>
        <div className="mt-5 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-secondary/40 text-3xl">
            {king.emoji}
          </div>
          <div>
            <div className="font-display text-2xl">${king.ticker}</div>
            <div className="text-sm text-muted-foreground">{king.blurb}</div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3 text-xs">
          <KingStat label="Market cap" value={fmtUsd(king.mcap)} />
          <KingStat label="LP (USDC)" value={fmtUsd(king.liq)} />
          <KingStat label="24h" value={`${king.changePct >= 0 ? "+" : ""}${king.changePct.toFixed(1)}%`} good={king.changePct >= 0} />
          <KingStat label="Cycles run" value={king.cycles.toLocaleString()} />
          <KingStat label="Holders" value={king.holders.toLocaleString()} />
          <KingStat label="Age" value={fmtAge(king.ageMin)} />
        </div>
        <button
          type="button"
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 font-bold text-primary-foreground transition hover:scale-[1.02]"
        >
          Trade ${king.ticker} <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function KingStat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-display text-base ${good === undefined ? "" : good ? "text-accent" : "text-destructive"}`}>
        {value}
      </div>
    </div>
  );
}

function SortPill({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition ${
        active
          ? "border-accent bg-accent text-accent-foreground"
          : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function CoinCard({ c }: { c: MockCoin }) {
  const positive = c.changePct >= 0;
  return (
    <button
      type="button"
      className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card/60 p-4 text-left backdrop-blur transition hover:-translate-y-1 hover:border-accent hover:bg-card"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/40 text-2xl">
          {c.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-display text-base">${c.ticker}</span>
            {c.hot && (
              <span className="inline-flex items-center gap-0.5 rounded-sm bg-destructive/20 px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-destructive">
                <Flame className="h-2.5 w-2.5" /> hot
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{c.blurb}</div>
        </div>
        <div className={`shrink-0 text-right font-mono text-xs font-bold ${positive ? "text-accent" : "text-destructive"}`}>
          {positive ? "+" : ""}
          {c.changePct.toFixed(1)}%
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-widest">
        <Cell label="mcap" value={fmtUsd(c.mcap)} />
        <Cell label="lp" value={fmtUsd(c.liq)} />
        <Cell label="age" value={fmtAge(c.ageMin)} />
      </div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>{c.holders.toLocaleString()} holders</span>
        <span className="flex items-center gap-1 text-accent">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          {c.cycles} cycles
        </span>
      </div>
    </button>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-secondary/20 px-2 py-1">
      <div className="text-[8px] text-muted-foreground">{label}</div>
      <div className="font-display text-xs">{value}</div>
    </div>
  );
}

function LaunchCTA() {
  return (
    <button
      type="button"
      className="group flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent/60 bg-accent/5 p-6 text-center transition hover:-translate-y-1 hover:bg-accent/10"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-foreground transition group-hover:scale-110">
        <Rocket className="h-6 w-6" />
      </div>
      <div className="font-display text-lg">LAUNCH YOUR COIN</div>
      <div className="text-xs text-muted-foreground">30 seconds. auto-LP from minute one.</div>
    </button>
  );
}
