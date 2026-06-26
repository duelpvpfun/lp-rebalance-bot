import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Copy, Rocket, Users, Flame, Sparkles, TrendingUp, Search } from "lucide-react";
import { toast } from "sonner";

const COMMUNITY_URL = "https://x.com/i/communities/2033361508042780851";

export const Route = createFileRoute("/launch")({
  head: () => ({
    meta: [
      { title: "Launchpad — Liquititty" },
      { name: "description", content: "Launch self-refilling memecoins. Every coin auto-recycles creator fees back into its own USDC LP." },
      { property: "og:title", content: "Liquititty Launchpad" },
      { property: "og:description", content: "Launch a coin that grows its own LP on autopilot." },
    ],
  }),
  component: LaunchPage,
});

type Coin = {
  ticker: string; name: string; blurb: string; emoji: string;
  mint: string; dev: string;
  mcap: number; liq: number; changePct: number; ageMin: number;
  cycles: number; holders: number; replies: number;
  hot?: boolean; king?: boolean;
};

const MOCK: Coin[] = [
  { ticker: "LIQUITITTY", name: "Liquititty", blurb: "the OG self-refilling memecoin.", emoji: "🍑", mint: "Liq1t1ttyMintCa11111111111111111111111111111", dev: "DEV1qty7sX2bA9", mcap: 842000, liq: 214000, changePct: 38.4, ageMin: 11, cycles: 1342, holders: 4811, replies: 312, king: true, hot: true },
  { ticker: "FATSTACK", name: "Fat Stack", blurb: "we eat the fees for breakfast.", emoji: "🥞", mint: "FatStackMint22222222222222222222222222222222", dev: "BAGoFwR4q1Mn", mcap: 184200, liq: 51200, changePct: 22.1, ageMin: 42, cycles: 612, holders: 1280, replies: 144, hot: true },
  { ticker: "JUGZ", name: "Jugz", blurb: "biggest jugs on solana.", emoji: "🍼", mint: "JugzMint333333333333333333333333333333333333", dev: "JG2vbN8pQz", mcap: 96100, liq: 27800, changePct: 9.4, ageMin: 88, cycles: 411, holders: 822, replies: 91 },
  { ticker: "REFILL", name: "Refill Coin", blurb: "the pool only goes up.", emoji: "🧴", mint: "Refi11Mint444444444444444444444444444444444", dev: "REFnnp02Lk", mcap: 71400, liq: 19500, changePct: -3.2, ageMin: 124, cycles: 287, holders: 519, replies: 47 },
  { ticker: "BOOBA", name: "Booba", blurb: "two bags. one mission.", emoji: "👯", mint: "BoobaMint555555555555555555555555555555555", dev: "BBA9xnq4eR", mcap: 54320, liq: 14100, changePct: 14.7, ageMin: 198, cycles: 188, holders: 402, replies: 38, hot: true },
  { ticker: "DRIP", name: "Drip Drip", blurb: "fees go drip drip into LP.", emoji: "💧", mint: "DripMint666666666666666666666666666666666666", dev: "DRP1nM4xL", mcap: 41200, liq: 11200, changePct: 6.8, ageMin: 240, cycles: 142, holders: 311, replies: 22 },
  { ticker: "MILKY", name: "Milky Way", blurb: "galactic liquidity.", emoji: "🌌", mint: "MilkyMint777777777777777777777777777777777", dev: "MKY8pq2nE", mcap: 28900, liq: 8200, changePct: -1.1, ageMin: 312, cycles: 91, holders: 244, replies: 18 },
  { ticker: "POOL", name: "Pool Party", blurb: "always 100% paired.", emoji: "🏊", mint: "PoolMint8888888888888888888888888888888888", dev: "PL3vNq0Rt", mcap: 18450, liq: 5400, changePct: 4.4, ageMin: 480, cycles: 60, holders: 188, replies: 11 },
  { ticker: "BBAG", name: "Big Bag", blurb: "the only bag that refills.", emoji: "💰", mint: "BBagMint99999999999999999999999999999999999", dev: "BBG5tQp", mcap: 12300, liq: 3600, changePct: -8.9, ageMin: 612, cycles: 38, holders: 121, replies: 5 },
];

function fmt(n: number, p = "") {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return `${p}${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${p}${(n / 1e3).toFixed(1)}K`;
  return `${p}${n.toFixed(0)}`;
}
function fmtAge(min: number) {
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}
function short(s: string) { return s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s; }

function LaunchPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"hot" | "new" | "mcap">("hot");

  const king = MOCK.find((c) => c.king) ?? MOCK[0];

  const filtered = useMemo(() => {
    let arr = MOCK.filter((c) => c.ticker.toLowerCase().includes(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase()));
    if (sort === "new") arr = [...arr].sort((a, b) => a.ageMin - b.ageMin);
    else if (sort === "mcap") arr = [...arr].sort((a, b) => b.mcap - a.mcap);
    else arr = [...arr].sort((a, b) => Number(b.hot ?? 0) - Number(a.hot ?? 0) || b.changePct - a.changePct);
    return arr;
  }, [q, sort]);

  return (
    <div className="pf-theme flex min-h-screen flex-col">
      {/* HEADER */}
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 text-sm">
          <div className="flex items-center gap-4">
            <Link to="/" className="font-bold text-primary">liquititty.fun</Link>
            <nav className="hidden gap-3 md:flex">
              <Link to="/" className="pf-link">home</Link>
              <a href="https://x.com/liquititty" target="_blank" rel="noreferrer" className="pf-link">twitter</a>
              <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" className="pf-link">community</a>
              <a href="/#how" className="pf-link">how it works</a>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" aria-label="community" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-secondary/40 hover:border-primary/60">
              <Users className="h-4 w-4" />
            </a>
            <Link to="/launch/create" className="pf-shine inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground">
              <Rocket className="h-3.5 w-3.5" /> launch a coin
            </Link>
          </div>
        </div>
      </header>

      {/* TICKER */}
      <div className="overflow-hidden border-b border-border/60 bg-secondary/20 py-2">
        <div className="pf-ticker-anim flex w-max items-center gap-6 whitespace-nowrap px-4 font-mono text-[11px] uppercase tracking-wider">
          {[...MOCK, ...MOCK].map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span>{c.emoji}</span>
              <span className="font-bold">${c.ticker}</span>
              <span className={c.changePct >= 0 ? "text-primary" : "text-destructive"}>
                {c.changePct >= 0 ? "+" : ""}{c.changePct.toFixed(1)}%
              </span>
              <span className="opacity-50">·</span>
            </span>
          ))}
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-16">
        {/* start a new coin */}
        <div className="pt-10 text-center">
          <Link to="/launch/create" className="text-xl font-bold pf-link">start a new coin</Link>
        </div>

        {/* KING OF THE HILL */}
        <section className="mt-6 flex flex-col items-center">
          <div
            className="pf-shine mb-2 inline-block rounded-md px-3 py-1 text-xs font-black uppercase italic tracking-wide"
            style={{
              background: "linear-gradient(180deg, oklch(0.85 0.18 75), oklch(0.65 0.20 45))",
              color: "#3a1a00",
              textShadow: "0 1px 0 rgba(255,255,255,0.3)",
              border: "2px solid oklch(0.50 0.18 40)",
            }}
          >
            👑 king of the hill
          </div>
          <div className="pf-king p-2">
            <FeaturedCoin c={king} />
          </div>
        </section>

        {/* SEARCH */}
        <div className="mx-auto mt-10 flex max-w-2xl items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search for token"
            className="flex-1 rounded-md border border-border bg-input/60 px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
          <button type="button" className="rounded-md bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">
            search
          </button>
        </div>

        {/* FILTERS */}
        <div className="mt-10 flex flex-wrap items-center gap-3 border-b border-border/60 pb-3 text-sm">
          <span className="font-bold text-primary">Terminal</span>
          <span className="text-muted-foreground">·</span>
          <SortPill icon={<Flame className="h-3 w-3" />} label="hot" active={sort === "hot"} onClick={() => setSort("hot")} />
          <SortPill icon={<Sparkles className="h-3 w-3" />} label="newest" active={sort === "new"} onClick={() => setSort("new")} />
          <SortPill icon={<TrendingUp className="h-3 w-3" />} label="market cap" active={sort === "mcap"} onClick={() => setSort("mcap")} />
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]" />
            </span>
            {filtered.length} live
          </span>
        </div>

        {/* FEED */}
        <div className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => <CoinRow key={c.ticker} c={c} />)}
        </div>
      </main>

      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <div>liquititty.fun · built on solana · auto-LP on pumpswap</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">v0.0.1</div>
          <div className="flex items-center gap-2">
            <a href="https://x.com/liquititty" target="_blank" rel="noreferrer" className="pf-link">twitter</a>
            <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" className="pf-link">community</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SortPill({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs ${active ? "bg-primary/20 text-primary" : "border border-border text-muted-foreground hover:text-foreground"}`}
    >
      {icon}
      sort: {label}
    </button>
  );
}

function CoinAvatar({ c, size = 88 }: { c: Coin; size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="shrink-0 overflow-hidden rounded-sm bg-secondary ring-1 ring-border grid place-items-center text-3xl"
    >
      <span>{c.emoji}</span>
    </div>
  );
}

function Chips({ c }: { c: Coin }) {
  return (
    <div className="mb-1 flex items-center gap-1">
      <span
        className="pf-chip pf-chip-green inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 !text-[10px] !font-black uppercase tracking-wider"
        title="auto-LP cycles run for this coin"
      >
        🔁 {fmt(c.cycles)}
      </span>
      <span className="pf-chip pf-chip-orange inline-flex items-center rounded-sm px-1.5 py-0.5 !text-[10px] !font-black uppercase tracking-wider tabular-nums" title="USDC sitting in LP">
        LP {fmt(c.liq, "$")}
      </span>
      {c.hot && (
        <span className="inline-flex items-center gap-0.5 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
          <Flame className="h-2.5 w-2.5" /> hot
        </span>
      )}
    </div>
  );
}

function FeaturedCoin({ c }: { c: Coin }) {
  return (
    <div className="relative">
      <Link to="/launch" className="group flex items-start gap-3 pf-card rounded-md p-2.5">
        <CoinAvatar c={c} size={64} />
        <div className="text-xs leading-relaxed">
          <Chips c={c} />
          <div className="text-muted-foreground">
            Created by <span className="text-primary font-semibold">{short(c.dev)}</span>
          </div>
          <div className="text-muted-foreground">
            market cap: <span className="text-primary font-bold">{fmt(c.mcap, "$")}</span>{" "}
            <span className="ml-1">[badge: 👑]</span>
          </div>
          <div className="text-muted-foreground">
            holders: <span className="text-foreground">{fmt(c.holders)}</span>
          </div>
          <div className="mt-1 text-sm font-bold text-foreground group-hover:text-primary">
            {c.name} <span className="text-muted-foreground font-normal">(ticker: ${c.ticker})</span>
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground/80">
            CA: {short(c.mint)}
          </div>
        </div>
      </Link>
    </div>
  );
}

function CoinRow({ c }: { c: Coin }) {
  return (
    <div className="group relative">
      <Link
        to="/launch"
        className="relative flex items-start gap-3 overflow-hidden rounded-md border border-transparent p-2 transition group-hover:border-primary/40 group-hover:bg-primary/5 group-hover:shadow-[0_0_20px_-4px_var(--color-primary)]"
      >
        <CoinAvatar c={c} size={88} />
        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          <Chips c={c} />
          <div className="text-muted-foreground">
            Created by <span className="text-primary font-semibold">{short(c.dev)}</span>
            <span className="ml-2 opacity-70">· {fmtAge(c.ageMin)}</span>
          </div>
          <div className="text-muted-foreground">
            market cap: <span className="text-primary font-bold">{fmt(c.mcap, "$")}</span>
            <span className={`ml-2 ${c.changePct >= 0 ? "text-primary" : "text-destructive"}`}>
              {c.changePct >= 0 ? "+" : ""}{c.changePct.toFixed(1)}%
            </span>
          </div>
          <div className="text-muted-foreground">
            holders: <span className="text-foreground">{fmt(c.holders)}</span>
            <span className="ml-3">replies: <span className="text-foreground">{c.replies}</span></span>
          </div>
          <div className="mt-1 truncate font-bold text-foreground group-hover:text-primary">
            {c.name} <span className="text-muted-foreground font-normal">(${c.ticker})</span>
            <span className="text-muted-foreground font-normal">: {c.blurb}</span>
          </div>
          <div className="mt-1.5 font-mono text-[10px] text-muted-foreground/80 truncate">CA: {c.mint}</div>
        </div>
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          navigator.clipboard.writeText(c.mint);
          toast.success(`copied ${c.ticker} CA`);
        }}
        title={`Copy contract: ${c.mint}`}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-primary/50 bg-background/90 px-2 py-1 font-mono text-[10px] font-semibold text-primary backdrop-blur transition hover:bg-primary hover:text-primary-foreground"
      >
        <Copy className="h-3 w-3" /> copy CA
      </button>
    </div>
  );
}
