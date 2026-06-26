import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import logo from "@/assets/liquititty-logo.webp";
import { getStats } from "@/lib/stats.functions";

const COMMUNITY_URL = "https://x.com/i/communities/2033361508042780851";
// Real CA launch cutoff (unix seconds). Any tx with blockTime before this is
// from the test phase and gets a red TEST badge.
const REAL_LAUNCH_CUTOFF = 1782446614;

const statsQuery = queryOptions({
  queryKey: ["stats"],
  queryFn: () => getStats(),
  refetchInterval: 30_000,
  staleTime: 15_000,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Liquititty — The Self-Refilling Memecoin" },
      {
        name: "description",
        content:
          "Every creator reward is auto-claimed in USDC, partly bought back into $LIQUITITTY, and dumped back into the PumpSwap LP. Liquidity only goes up.",
      },
      { property: "og:title", content: "Liquititty" },
      { property: "og:description", content: "Tits up. Liquidity up. Fully on-chain auto-LP." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(statsQuery),
  component: Index,
  errorComponent: ({ error }) => (
    <div className="p-10 text-center text-muted-foreground">
      Couldn't load live stats: {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-10">Not found.</div>,
});

function Index() {
  const { data } = useSuspenseQuery(statsQuery);
  const buyUrl = data.mint ? `https://pump.fun/coin/${data.mint}` : "https://pump.fun";
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Liquititty logo" className="h-10 w-10 rounded-lg shadow-lg" />
          <span className="font-display text-xl">LIQUITITTY</span>
        </div>
        <nav className="hidden gap-8 text-sm md:flex">
          <a href="#how" className="opacity-80 hover:opacity-100">How it works</a>
          <a href="#activity" className="opacity-80 hover:opacity-100">Live activity</a>
          <a href="#tokenomics" className="opacity-80 hover:opacity-100">Tokenomics</a>
          <a href="#faq" className="opacity-80 hover:opacity-100">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <CommunityIcon />
          <a
            id="buy"
            href={buyUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground shadow-lg transition hover:scale-105"
          >
            Buy
          </a>
        </div>
      </header>

      <Suspense fallback={<StatsBarSkeleton />}>
        <StatsBar />
      </Suspense>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-2 md:py-20">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-4 py-1.5 text-xs uppercase tracking-widest backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            Live on Pump.fun · USDC pair
          </div>
          <h1 className="text-5xl leading-[0.95] md:text-7xl">
            TITS UP.<br />
            <span className="text-accent">LIQUIDITY</span> UP.
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground">
            $LIQUITITTY is a memecoin that pays its own bills. Every time the pool earns
            creator rewards, a robot grabs the cash and shoves it straight back into the
            liquidity pool. You don't have to trust anyone — it just happens, every 1 minute.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={buyUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-accent px-6 py-3 font-bold text-accent-foreground shadow-xl transition hover:scale-105"
            >
              Buy →
            </a>
            <a
              href={COMMUNITY_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-border px-6 py-3 font-semibold backdrop-blur transition hover:bg-secondary/40"
            >
              Join the community
            </a>
            <a
              href="#how"
              className="rounded-full border border-border px-6 py-3 font-semibold backdrop-blur transition hover:bg-secondary/40"
            >
              How it works
            </a>
          </div>
        </div>
        <div className="relative mx-auto">
          <div className="absolute inset-0 -z-10 blur-3xl">
            <div className="h-full w-full rounded-full bg-accent/40" />
          </div>
          <img src={logo} alt="Liquititty" className="w-full max-w-md rounded-3xl shadow-2xl" />
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-widest text-accent">Explain it like I'm 5</p>
          <h2 className="mt-2 text-4xl md:text-5xl">HOW LIQUIDITY GROWS BY ITSELF</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            A liquidity pool is just two buckets: one with $LIQUITITTY and one with USDC.
            People trade between them. Every trade pays a tiny fee, and pump.fun gives
            those fees to the coin's creator. Most coins, the creator pockets them.
            $LIQUITITTY doesn't. A bot does this on a 1-minute loop:
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-4">
          {[
            { n: "01", t: "Collect the rent", d: "The dev wallet auto-claims creator fees from pump.fun. These arrive as real USDC (dollars)." },
            { n: "02", t: "Buy some $LIQUITITTY", d: "35% of that USDC is used to market-buy $LIQUITITTY on PumpSwap. Yes, that nudges the price up — that's the point." },
            { n: "03", t: "Pair them up", d: "Now the wallet holds fresh $LIQUITITTY and the remaining USDC. The bot checks the current pool ratio so the two sides match." },
            { n: "04", t: "Refill the pool", d: "Both bags go straight back into the PumpSwap liquidity pool. The pool is bigger than it was 1 minute ago. Repeat forever." },
          ].map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur transition hover:-translate-y-1 hover:bg-card">
              <div className="font-display text-3xl text-accent">{s.n}</div>
              <div className="mt-2 text-xl font-bold">{s.t}</div>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-border bg-secondary/30 p-6 text-sm text-muted-foreground md:p-8">
          <p className="font-bold text-foreground">Why 35% and not 50/50?</p>
          <p className="mt-2">
            When the bot buys $LIQUITITTY, the price moves a little. So if it spent half
            on tokens and tried to LP the other half, the ratio would already be off and
            the deposit would leave USDC behind. 35% is the sweet spot to get a clean
            deposit. If the price keeps pumping between the buy and the LP, the bot
            shrinks the token side until the USDC matches and saves the leftover
            $LIQUITITTY for the next round.{" "}
            <span className="text-foreground">Nothing ever leaves the wallet.</span>
          </p>
        </div>
      </section>

      <section id="activity" className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-accent">On-chain receipts</p>
            <h2 className="mt-2 text-4xl md:text-5xl">DEV WALLET ACTIVITY</h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Only the three actions the bot is allowed to do: claim, buy, LP.
              Click any row to verify it on Solscan yourself.
            </p>
          </div>
          <Suspense fallback={null}>
            <NextCycleTimer />
          </Suspense>
        </div>
        <Suspense fallback={<TxListSkeleton />}>
          <TxList />
        </Suspense>
      </section>

      <section id="tokenomics" className="mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-3xl border border-border bg-secondary/30 p-10 backdrop-blur md:p-16">
          <h2 className="text-4xl md:text-5xl">HONEST TITONOMICS</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            <Stat label="Supply" value="1,000,000,000" />
            <Stat label="Quote pair" value="USDC" />
            <Stat label="Creator fees" value="→ Auto LP" />
            <Stat label="Buyback %" value="35% of every claim" />
            <Stat label="Re-LP %" value="100% of bought coin" />
            <Stat label="Team Wallet" value="0% — dev = bot" />
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="text-4xl md:text-5xl">FAQ</h2>
        <div className="mt-8 space-y-4">
          <Faq q="Wait, so the dev can't rug me?" a="The dev wallet only ever does three things: claim creator fees, buy $LIQUITITTY, deposit into the LP. No transfers out. Watch it live in the activity section." />
          <Faq q="How often does it run?" a="Every 1 minute (test mode). The countdown to the next cycle is right at the top of the activity section." />
          <Faq q="Does the LP keep growing forever?" a="As long as people trade $LIQUITITTY, yes. Trading pays fees → fees become liquidity → bigger LP = less slippage → more trading. Flywheel." />
          <Faq q="What if the price moons between the buy and the deposit?" a="The bot retries the LP with a smaller token amount each pass until the USDC matches. Leftover tokens stay in the wallet and ship on the next cycle." />
          <Faq q="What chain?" a="Solana. PumpSwap pool. USDC pair." />
          <Faq q="Why the logo?" a="Two tits. Liquidity. It writes itself." />
        </div>
      </section>

      <footer className="border-t border-border/50 py-10 text-center text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6">
          <img src={logo} alt="" className="h-8 w-8 rounded" />
          <div className="flex items-center gap-3">
            <CommunityIcon />
            <span>© {new Date().getFullYear()} $LIQUITITTY. Not financial advice. Not even good advice.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function CommunityIcon() {
  return (
    <a
      href={COMMUNITY_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Join the community"
      title="Community"
      className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary/40 text-foreground transition hover:scale-110 hover:bg-secondary"
    >
      <Users className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}

function StatsBar() {
  const { data } = useSuspenseQuery(statsQuery);
  const d = data.dex;
  return (
    <section className="mx-auto max-w-6xl px-6">
      <div className="grid gap-4 md:grid-cols-4">
        <LiveBlock label="Market Cap" value={fmtUsd(d.marketCapUsd)} />
        <LiveBlock label="Liquidity (USD)" value={fmtUsd(d.liquidityUsd)} />
        <LiveBlock label="USDC in LP" value={fmtNum(d.liquidityUsdc, "USDC")} />
        <LiveBlock label="$LIQUITITTY in LP" value={fmtNum(d.liquidityToken, "LIQUITITTY")} />
      </div>
      <div className="mt-2 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
        Live · refreshes every 30s · price ${d.priceUsd?.toFixed(8) ?? "—"} ·{" "}
        {d.pairUrl ? (
          <a className="underline" target="_blank" rel="noreferrer" href={d.pairUrl}>chart</a>
        ) : ("no pair yet")}
      </div>
    </section>
  );
}

function StatsBarSkeleton() {
  return (
    <section className="mx-auto max-w-6xl px-6">
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-card/40" />
        ))}
      </div>
    </section>
  );
}

function LiveBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-5 backdrop-blur">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-2xl md:text-3xl">{value}</div>
    </div>
  );
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

type TickResponse = {
  ran?: boolean;
  ok?: boolean;
  done?: boolean;
  phase?: "claim" | "buy" | "lp" | "burn" | "idle";
  nextPhase?: "claim" | "buy" | "lp" | "burn" | "idle";
  reason?: "cooldown" | "in_flight";
  secondsUntilNext?: number;
};

const PHASE_LABEL: Record<string, string> = {
  claim: "Claiming USDC",
  buy: "Buying $LIQUITITTY",
  lp: "Adding to LP",
  burn: "Burning LP",
};

function NextCycleTimer() {
  const { data } = useSuspenseQuery(statsQuery);
  const queryClient = useQueryClient();
  const mounted = useMounted();
  const now = useNow(1000);
  const inFlightRef = useRef(false);
  const initialCooldownMs = data.cycleRuntime.cooldownUntil
    ? data.cycleRuntime.cooldownUntil * 1000
    : Date.now() + data.cycleIntervalSec * 1000;
  const initialPhase = data.cycleRuntime.phase !== "idle" ? data.cycleRuntime.phase : null;
  const [nextAt, setNextAt] = useState(() => initialCooldownMs);
  const [activePhase, setActivePhase] = useState<string | null>(initialPhase);
  const [phaseStartedAt, setPhaseStartedAt] = useState<number | null>(
    data.cycleRuntime.cycleStartAt ? data.cycleRuntime.cycleStartAt * 1000 : null,
  );

  useEffect(() => {
    if (!mounted) return;
    const runtimePhase = data.cycleRuntime.phase !== "idle" ? data.cycleRuntime.phase : null;
    setActivePhase(runtimePhase);
    setPhaseStartedAt(runtimePhase && data.cycleRuntime.cycleStartAt ? data.cycleRuntime.cycleStartAt * 1000 : null);
    if (!runtimePhase && data.cycleRuntime.cooldownUntil) {
      setNextAt(data.cycleRuntime.cooldownUntil * 1000);
    }
  }, [data.cycleRuntime.phase, data.cycleRuntime.cycleStartAt, data.cycleRuntime.cooldownUntil, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const poll = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await fetch("/api/public/tick", { method: "GET" });
        const result = (await res.json()) as TickResponse;
        const secs = typeof result.secondsUntilNext === "number" ? result.secondsUntilNext : 5;

        if (result.ran) {
          if (result.done) {
            setActivePhase(null);
            setPhaseStartedAt(null);
            setNextAt(Date.now() + Math.max(1, secs) * 1000);
          } else {
            const next = result.nextPhase && result.nextPhase !== "idle" ? result.nextPhase : null;
            setActivePhase((prev) => {
              if (prev !== next) setPhaseStartedAt(Date.now());
              return next;
            });
            setNextAt(Date.now() + Math.max(1, secs) * 1000);
          }
          queryClient.invalidateQueries({ queryKey: statsQuery.queryKey });
        } else if (result.reason === "cooldown") {
          setActivePhase(null);
          setPhaseStartedAt(null);
          setNextAt(Date.now() + Math.max(1, secs) * 1000);
        } else if (result.reason === "in_flight") {
          setActivePhase((prev) => {
            if (!prev) {
              setPhaseStartedAt(Date.now());
              return result.phase && result.phase !== "idle" ? result.phase : "claim";
            }
            return prev;
          });
        }
      } catch {
        /* network blip — keep state */
      } finally {
        inFlightRef.current = false;
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 5_000);
    return () => clearInterval(id);
  }, [mounted, queryClient]);

  const remaining = Math.max(0, Math.floor((nextAt - now) / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const elapsed = phaseStartedAt ? Math.floor((now - phaseStartedAt) / 1000) : 0;
  const label = activePhase ? PHASE_LABEL[activePhase] ?? activePhase : null;

  return (
    <div className="rounded-2xl border border-border bg-card/60 px-5 py-3 text-center backdrop-blur min-w-[200px]">
      <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        {activePhase && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />}
        {activePhase ? label : "Next cycle in"}
      </div>
      {activePhase ? (
        <div className="font-display text-lg text-accent" suppressHydrationWarning>
          {mounted ? `confirming · ${elapsed}s` : "…"}
        </div>
      ) : (
        <div className="font-display text-3xl tabular-nums text-accent" suppressHydrationWarning>
          {mounted ? `${mm}:${ss}` : "--:--"}
        </div>
      )}
    </div>
  );
}


function TxList() {
  const { data } = useSuspenseQuery(statsQuery);
  const mounted = useMounted();
  if (!mounted) return <TxListSkeleton />;

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card/40 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3 text-xs uppercase tracking-widest text-muted-foreground">
        <span>Dev wallet</span>
        <a
          target="_blank"
          rel="noreferrer"
          href={`https://solscan.io/account/${data.devWallet}`}
          className="font-mono normal-case tracking-normal text-foreground hover:text-accent"
        >
          {short(data.devWallet)} ↗
        </a>
      </div>
      <ul className="divide-y divide-border/40">
        {data.txs.length === 0 && (
          <li className="px-5 py-6 text-center text-sm text-muted-foreground">
            No activity yet — first cycle runs as soon as creator fees accrue.
          </li>
        )}
        {data.txs.map((t) => (
          <li key={t.signature} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className={`inline-block h-2 w-2 rounded-full ${t.success ? "bg-accent" : "bg-destructive"}`} />
              <div>
                <div className="flex items-center gap-2 font-bold">
                  {t.label}
                  {t.blockTime != null && t.blockTime < REAL_LAUNCH_CUTOFF && (
                    <span className="rounded-md border border-destructive/60 bg-destructive/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-destructive">
                      TEST
                    </span>
                  )}
                </div>
                <RelativeTime t={t.blockTime} />
              </div>
            </div>
            <a
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-muted-foreground hover:text-accent"
              href={`https://solscan.io/tx/${t.signature}`}
            >
              {short(t.signature)} ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RelativeTime({ t }: { t: number | null }) {
  const mounted = useMounted();
  const now = useNow(15_000);
  if (!t) return <div className="text-xs text-muted-foreground">pending</div>;
  // Render an absolute timestamp during SSR / first paint to avoid hydration drift.
  const absolute = new Date(t * 1000).toISOString().slice(11, 16) + " UTC";
  if (!mounted) {
    return <div className="text-xs text-muted-foreground" suppressHydrationWarning>{absolute}</div>;
  }
  const diff = now / 1000 - t;
  let label: string;
  if (diff < 60) label = `${Math.floor(diff)}s ago`;
  else if (diff < 3600) label = `${Math.floor(diff / 60)}m ago`;
  else if (diff < 86400) label = `${Math.floor(diff / 3600)}h ago`;
  else label = new Date(t * 1000).toLocaleDateString();
  return <div className="text-xs text-muted-foreground" suppressHydrationWarning>{label}</div>;
}

function TxListSkeleton() {
  return <div className="mt-8 h-64 animate-pulse rounded-2xl border border-border bg-card/40" />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl">{value}</div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-2xl border border-border bg-card/60 p-5 backdrop-blur">
      <summary className="cursor-pointer list-none text-lg font-bold flex justify-between items-center">
        {q}
        <span className="text-accent transition group-open:rotate-45">+</span>
      </summary>
      <p className="mt-3 text-muted-foreground">{a}</p>
    </details>
  );
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}
function fmtNum(n: number | null, _suffix?: string): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}
function short(s: string): string {
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
