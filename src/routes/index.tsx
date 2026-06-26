import { createFileRoute } from "@tanstack/react-router";
import logo from "@/assets/liquititty-logo.webp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Liquititty — Auto-LP Token on PumpSwap" },
      { name: "description", content: "Creator rewards auto-buy 35% back into $TITTY and refill the PumpSwap LP. Every claim, the liquidity grows." },
      { property: "og:title", content: "Liquititty" },
      { property: "og:description", content: "Tits up. Liquidity up. Fully automated LP on PumpSwap." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Liquititty logo" className="h-10 w-10 rounded-lg shadow-lg" />
          <span className="font-display text-xl">LIQUITITTY</span>
        </div>
        <nav className="hidden gap-8 text-sm md:flex">
          <a href="#how" className="opacity-80 hover:opacity-100">How it works</a>
          <a href="#tokenomics" className="opacity-80 hover:opacity-100">Tokenomics</a>
          <a href="#faq" className="opacity-80 hover:opacity-100">FAQ</a>
        </nav>
        <a
          href="#buy"
          className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground shadow-lg transition hover:scale-105"
        >
          Buy $TITTY
        </a>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:grid-cols-2 md:py-24">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-4 py-1.5 text-xs uppercase tracking-widest backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            Live on Pump.fun
          </div>
          <h1 className="text-5xl leading-[0.95] md:text-7xl">
            TITS UP.<br />
            <span className="text-accent">LIQUIDITY</span> UP.
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground">
            Liquititty is the self-juicing memecoin. Every creator reward is auto-claimed,
            35% gets market-bought back into $TITTY, then 100% of the coin + USDC is dumped
            straight back into the PumpSwap LP. Forever.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              id="buy"
              href="https://pump.fun"
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-accent px-6 py-3 font-bold text-accent-foreground shadow-xl transition hover:scale-105"
            >
              Ape on PumpSwap →
            </a>
            <a
              href="#how"
              className="rounded-full border border-border px-6 py-3 font-semibold backdrop-blur transition hover:bg-secondary/40"
            >
              See the mechanism
            </a>
          </div>
          <div className="mt-8 flex gap-6 text-xs uppercase tracking-widest opacity-70">
            <div><div className="text-2xl font-display text-foreground">100%</div>LP recycled</div>
            <div><div className="text-2xl font-display text-foreground">35%</div>Auto buyback</div>
            <div><div className="text-2xl font-display text-foreground">0</div>Team unlocks</div>
          </div>
        </div>
        <div className="relative mx-auto">
          <div className="absolute inset-0 -z-10 blur-3xl">
            <div className="h-full w-full rounded-full bg-accent/40" />
          </div>
          <img
            src={logo}
            alt="Liquititty"
            className="w-full max-w-md rounded-3xl shadow-2xl"
          />
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-4xl md:text-5xl">THE GLAND CYCLE</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Fully on-chain. No multisig babysitter. Triggered every time creator rewards accrue.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-4">
          {[
            { n: "01", t: "Claim", d: "Dev wallet auto-claims creator rewards from Pump.fun in SOL." },
            { n: "02", t: "Buy 35%", d: "35% of the SOL is market-bought back into $TITTY on PumpSwap." },
            { n: "03", t: "Pair", d: "100% of the bought $TITTY pairs with the remaining USDC value." },
            { n: "04", t: "LP", d: "Both are deposited into the PumpSwap LP. Pool grows. Forever." },
          ].map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur transition hover:-translate-y-1 hover:bg-card">
              <div className="font-display text-3xl text-accent">{s.n}</div>
              <div className="mt-2 text-xl font-bold">{s.t}</div>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="tokenomics" className="mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-3xl border border-border bg-secondary/30 p-10 backdrop-blur md:p-16">
          <h2 className="text-4xl md:text-5xl">HONEST TITONOMICS</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            <Stat label="Supply" value="1,000,000,000" />
            <Stat label="LP Burn" value="Pump.fun standard" />
            <Stat label="Creator Rewards" value="→ Auto LP" />
            <Stat label="Buyback %" value="35% of every claim" />
            <Stat label="Re-LP %" value="100% of bought coin" />
            <Stat label="Team Wallet" value="0% — dev = bot" />
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="text-4xl md:text-5xl">FAQ</h2>
        <div className="mt-8 space-y-4">
          <Faq q="Is this a rug?" a="The dev wallet only ever does one thing on a cron: claim → buy → LP. No transfers out. Verifiable on-chain." />
          <Faq q="Why 35% buyback?" a="It's the ratio that maintains roughly balanced LP additions given current PumpSwap pricing curves. Tweakable by community vote later." />
          <Faq q="What chain?" a="Solana. PumpSwap pool. USDC pair." />
          <Faq q="Why the logo?" a="Two tits. Liquidity. It writes itself." />
        </div>
      </section>

      <footer className="border-t border-border/50 py-10 text-center text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6">
          <img src={logo} alt="" className="h-8 w-8 rounded" />
          <div>© {new Date().getFullYear()} Liquititty. Not financial advice. Not even good advice.</div>
        </div>
      </footer>
    </div>
  );
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
