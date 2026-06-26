import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Rocket, Search, ArrowLeft, Upload, X, Info, Loader2, Sparkles, Lock } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/liquititty-logo.webp";
import { getStats } from "@/lib/stats.functions";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const COMMUNITY_URL = "https://x.com/i/communities/2033361508042780851";

export const Route = createFileRoute("/launch")({
  head: () => ({
    meta: [
      { title: "Launchpad — Liquititty" },
      {
        name: "description",
        content:
          "Launch a self-refilling memecoin. Every 3 minutes the bot claims creator fees, fees the treasury, buys back your token, redeposits the LP and burns the LP tokens.",
      },
      { property: "og:title", content: "Liquititty Launchpad" },
      {
        property: "og:description",
        content: "Launch a coin that grows its own LP on autopilot.",
      },
    ],
  }),
  component: LaunchPage,
});

function LaunchPage() {
  const [howOpen, setHowOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"bump" | "new" | "mcap">("bump");
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => getStats(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });


  // Demo king card so the layout matches the airlaunch terminal even before
  // the first real launch lands. Clicking it opens the create dialog.
  const openCreate = () => setCreateOpen(true);

  return (
    <div className="flex min-h-screen flex-col">
      {/* HEADER — matches airlaunch terminal header, our blue/gold palette */}
      <header className="border-b border-border/60">
        <div className="relative mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-3 py-3 text-sm sm:px-4 sm:gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="shrink-0">
              <img src={logo} alt="liquititty" className="pf-wiggle h-8 w-8 rounded-md" />
            </Link>
            <nav className="hidden flex-wrap items-center gap-x-3 gap-y-1 md:flex">
              <Link to="/" className="pf-link">home</Link>
              <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" className="pf-link">community</a>
              
              <button type="button" onClick={() => setHowOpen(true)} className="pf-link cursor-pointer">how it works</button>
            </nav>
          </div>
          <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 select-none font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 md:block">
            v0.0.1
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href={COMMUNITY_URL}
              target="_blank"
              rel="noreferrer"
              className="pf-shine inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent"
            >
              <Users className="h-3 w-3" /> community
            </a>
            <button
              type="button"
              onClick={openCreate}
              className="lp-glow inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wider text-accent-foreground transition hover:scale-[1.03]"
            >
              <Rocket className="h-3.5 w-3.5" />
              launch a coin
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-16">
        {/* start a new coin */}
        <div className="pt-10 text-center">
          <button type="button" onClick={openCreate} className="text-xl font-bold pf-link">
            start a new coin
          </button>
        </div>

        {/* KING OF THE HILL */}
        <section className="mt-6 flex flex-col items-center">
          <div
            className="pf-shine mb-2 inline-block rounded-md px-3 py-1 text-xs font-black uppercase italic tracking-wide"
            style={{
              background: "linear-gradient(180deg, oklch(0.92 0.18 95), oklch(0.78 0.18 85))",
              color: "oklch(0.28 0.12 260)",
              textShadow: "0 1px 0 rgba(255,255,255,0.35)",
              border: "2px solid oklch(0.55 0.2 95)",
            }}
          >
            👑 king of the hill
          </div>
          <div className="pf-king-aura">
            <a
              href={stats?.dex?.pairUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="pf-card group flex items-start gap-3 rounded-md p-2.5 text-left"
            >
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-secondary/40 ring-1 ring-border">
                <img src={logo} alt="liquititty" className="h-full w-full object-cover" />
              </div>
              <div className="text-xs leading-relaxed">
                <div className="mb-1 inline-block rounded-sm bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                  official · auto-LP live
                </div>
                <div className="text-muted-foreground">
                  market cap:{" "}
                  <span className="font-bold text-accent">
                    {fmtUsd(stats?.dex?.marketCapUsd)}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  liquidity:{" "}
                  <span className="font-bold text-foreground">
                    {fmtUsd(stats?.dex?.liquidityUsd)}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  in LP:{" "}
                  <span className="text-foreground">
                    {fmtNum(stats?.dex?.liquidityUsdc)} USDC
                  </span>{" "}
                  ·{" "}
                  <span className="text-foreground">
                    {fmtNum(stats?.dex?.liquidityToken)} $LIQUITITTY
                  </span>
                </div>
                <div className="mt-1 text-sm font-bold text-foreground group-hover:text-accent">
                  Liquititty{" "}
                  <span className="font-normal text-muted-foreground">(ticker: $LIQUITITTY)</span>
                </div>
                {stats?.mint && (
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                    CA: {stats.mint.slice(0, 6)}…{stats.mint.slice(-6)}
                  </div>
                )}
              </div>
            </a>
          </div>
        </section>


        {/* SEARCH */}
        <div className="mx-auto mt-10 flex max-w-2xl items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search for token"
              className="w-full rounded-md border border-border bg-input/60 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-accent"
            />
          </div>
          <button type="button" className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground">
            search
          </button>
        </div>

        {/* FILTERS */}
        <div className="mt-10 flex flex-wrap items-center gap-3 border-b border-border/60 pb-3 text-sm">
          <span className="font-bold text-accent">Terminal</span>
          <span className="text-muted-foreground">·</span>
          <SortPill label="bump order" active={sort === "bump"} onClick={() => setSort("bump")} />
          <SortPill label="newest" active={sort === "new"} onClick={() => setSort("new")} />
          <SortPill label="market cap" active={sort === "mcap"} onClick={() => setSort("mcap")} />
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
            </span>
            0 live
          </span>
        </div>

        {/* EMPTY STATE (no mocks until backend wired) */}
        <div className="mt-6 border border-dashed border-border bg-card/30 p-12 text-center text-sm">
          <Sparkles className="mx-auto h-6 w-6 text-accent" />
          <p className="mt-3 font-display text-xl">no launches yet</p>
          <p className="mt-2 text-muted-foreground">
            be the first — every coin launched here auto-refills its own LP every 3 minutes.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-4 inline-block pf-link font-bold"
          >
            launch the first coin
          </button>
        </div>
      </main>

      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <div>liquititty.fun · built on solana · auto-LP on pumpswap</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">v0.0.1</div>
          <a
            href={COMMUNITY_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="community"
            title="community"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 text-muted-foreground transition hover:border-accent/60 hover:text-accent"
          >
            <Users className="h-3.5 w-3.5" /> community
          </a>
        </div>
      </footer>

      <HowItWorksDialog open={howOpen} onClose={() => setHowOpen(false)} />
      <CreateCoinDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function SortPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs ${
        active
          ? "bg-accent/20 text-accent"
          : "border border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      sort: {label}
    </button>
  );
}


/* ============================================================
   HOW IT WORKS — modal
   ============================================================ */
function HowItWorksDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">How the loop works</DialogTitle>
          <DialogDescription>
            Every coin on the Liquititty launchpad runs the same on-chain loop.
            Fully automated, fully transparent, no human hands on the LP.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-accent">
            ⏱ runs every 3 minutes
          </div>
          <ol className="space-y-3 text-sm">
            <Step n={1} title="Claim creator rewards">
              The bot claims all USDC creator fees accumulated on your pump.fun coin.
            </Step>
            <Step n={2} title="10% → treasury fee">
              10% of the claimed USDC is sent to the Liquititty treasury — that's
              how the platform stays alive.
            </Step>
            <Step n={3} title="Swap dust to SOL">
              A tiny slice is swapped to SOL to cover network fees for the cycle.
            </Step>
            <Step n={4} title="Buy back ~35% into your token">
              ~35% of the remaining USDC is swapped into your coin via Jupiter.
              The buy hits your own market — every cycle pushes your chart.
            </Step>
            <Step n={5} title="Add 100% to the PumpSwap LP">
              The bought tokens + matching USDC are deposited into your PumpSwap
              LP. Price up or down, the bot always pairs the max it can.
            </Step>
            <Step n={6} title="Burn the LP tokens">
              The LP tokens minted from the deposit are burned. Liquidity is
              locked forever — nobody can pull it. Not you, not us.
            </Step>
            <Step n={7} title="Repeat">
              3 minutes later, it does the whole thing again. And again. And again.
            </Step>
          </ol>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-full bg-accent px-4 py-2.5 text-sm font-bold text-accent-foreground transition hover:scale-[1.02]"
        >
          got it, let's launch
        </button>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-accent/50 bg-accent/15 text-[11px] font-bold text-accent">
        {n}
      </span>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

/* ============================================================
   LAUNCH A COIN — modal with full form
   Payload shape is what the backend will receive once wired.
   ============================================================ */
type Form = {
  name: string;
  ticker: string;
  description: string;
  image_url: string;
  twitter: string;
  telegram: string;
  website: string;
  total_supply: number;
  buyback_pct: number;
  cycle_interval_seconds: number;
  treasury_fee_pct: number;
  min_claim_usdc: number;
  initial_sol_buy: number;
};

const DEFAULT_FORM: Form = {
  name: "",
  ticker: "",
  description: "",
  image_url: "",
  twitter: "",
  telegram: "",
  website: "",
  total_supply: 1_000_000_000,
  buyback_pct: 35,
  cycle_interval_seconds: 180,
  treasury_fee_pct: 10,
  min_claim_usdc: 1,
  initial_sol_buy: 0.5,
};

const MAX_INITIAL_BUY_SOL = 87;

function CreateCoinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const update = (k: keyof Form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.ticker) {
      toast.error("Name and ticker required");
      return;
    }
    setSubmitting(true);
    // UI-only for now — payload mirrors what the backend will accept.
    // eslint-disable-next-line no-console
    console.log("[liquititty] create-launch payload:", form);
    await new Promise((r) => setTimeout(r, 1100));
    setSubmitting(false);
    toast.success("Launch flow ready — backend wiring in progress");
    onClose();
    setStep(1);
    setForm(DEFAULT_FORM);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setStep(1);
        }
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {step === 1 ? "Launch your coin" : "Auto-LP & deployment"}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Token metadata — exactly what gets minted on pump.fun (USDC pair)."
              : "Configure the auto-LP loop. Defaults match the original Liquititty config."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <StepDot active={step === 1} done={step > 1} n={1} label="Token" />
          <span className="h-px flex-1 bg-border" />
          <StepDot active={step === 2} done={false} n={2} label="Auto-LP" />
        </div>

        <TooltipProvider delayDuration={150}>
          <form onSubmit={onSubmit} className="mt-4 space-y-5">
            {step === 1 ? (
              <>
                <Section title="Token">
                  <Field label="Name">
                    <input
                      className={cls}
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      placeholder="My Awesome Coin"
                    />
                  </Field>
                  <Field label="Ticker">
                    <input
                      className={cls}
                      value={form.ticker}
                      onChange={(e) => update("ticker", e.target.value.toUpperCase())}
                      placeholder="AWESOME"
                      maxLength={10}
                    />
                  </Field>
                  <Field label="Description" full>
                    <textarea
                      className={cls + " min-h-20"}
                      value={form.description}
                      onChange={(e) => update("description", e.target.value)}
                      placeholder="what's the coin about?"
                    />
                  </Field>
                  <Field label="Image" full>
                    <ImageDrop value={form.image_url} onChange={(v) => update("image_url", v)} />
                  </Field>
                </Section>

                <Section title="Links (optional)">
                  <Field
                    label="Twitter / X"
                    hint="Full x.com or twitter.com link, or leave empty. pump.fun rejects malformed links."
                    full
                  >
                    <input
                      className={cls}
                      value={form.twitter}
                      onChange={(e) => update("twitter", e.target.value)}
                      placeholder="https://x.com/yourhandle"
                    />
                  </Field>
                  <Field label="Telegram" hint="Full t.me link, or empty." full>
                    <input
                      className={cls}
                      value={form.telegram}
                      onChange={(e) => update("telegram", e.target.value)}
                      placeholder="https://t.me/yourgroup"
                    />
                  </Field>
                  <Field label="Website" hint="Full https:// URL or empty." full>
                    <input
                      className={cls}
                      value={form.website}
                      onChange={(e) => update("website", e.target.value)}
                      placeholder="https://example.com"
                    />
                  </Field>
                </Section>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (!form.name || !form.ticker) {
                        toast.error("Name and ticker required");
                        return;
                      }
                      setStep(2);
                    }}
                    className="rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-accent-foreground transition hover:scale-105"
                  >
                    next: auto-LP →
                  </button>
                </div>
              </>
            ) : (
              <>
                <Section title="Auto-LP rules">
                  <Field
                    label="Buyback %"
                    hint="Share of remaining USDC swapped back into your token before redepositing LP. 35% keeps LP perfectly paired."
                  >
                    <NumberSuffix
                      value={form.buyback_pct}
                      onChange={(v) => update("buyback_pct", v)}
                      suffix="%"
                      min={5}
                      max={95}
                    />
                  </Field>
                  <Field
                    label="Treasury fee %"
                    hint="Cut taken off the claimed USDC every cycle, sent to the Liquititty treasury."
                  >
                    <NumberSuffix
                      value={form.treasury_fee_pct}
                      onChange={(v) => update("treasury_fee_pct", v)}
                      suffix="%"
                      min={0}
                      max={50}
                    />
                  </Field>
                  <Field
                    label="Cycle interval"
                    hint="How often the bot fires: claim → buy → LP → burn. Default 180s (3 min)."
                  >
                    <NumberSuffix
                      value={form.cycle_interval_seconds}
                      onChange={(v) => update("cycle_interval_seconds", v)}
                      suffix="s"
                      min={60}
                      step={30}
                    />
                  </Field>
                  <Field
                    label="Min claimable USDC"
                    hint="Skip the cycle if claimable fees are below this — avoids burning gas on dust."
                  >
                    <NumberSuffix
                      value={form.min_claim_usdc}
                      onChange={(v) => update("min_claim_usdc", v)}
                      suffix="USDC"
                      min={0}
                      step={0.1}
                    />
                  </Field>
                </Section>

                <Section title="Deployment">
                  <Field
                    label="Initial buy (SOL)"
                    hint={`SOL spent on the pump.fun bonding curve at deploy. Capped at ${MAX_INITIAL_BUY_SOL} SOL (curve cap).`}
                    full
                  >
                    <NumberSuffix
                      value={form.initial_sol_buy}
                      onChange={(v) =>
                        update("initial_sol_buy", Math.min(MAX_INITIAL_BUY_SOL, Math.max(0, v)))
                      }
                      suffix="SOL"
                      min={0}
                      max={MAX_INITIAL_BUY_SOL}
                      step={0.01}
                    />
                  </Field>
                </Section>

                <div className="rounded-xl border border-accent/30 bg-accent/10 p-4 text-xs leading-relaxed">
                  <div className="font-bold uppercase tracking-wider text-accent">your loop</div>
                  <div className="mt-1 text-muted-foreground">
                    Every {form.cycle_interval_seconds}s · claim USDC · {form.treasury_fee_pct}% to
                    treasury · ~{form.buyback_pct}% buyback into ${form.ticker || "TOKEN"} ·
                    redeposit LP on PumpSwap · burn LP tokens · repeat forever.
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:bg-secondary/40"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> back
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-accent-foreground transition hover:scale-105 disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Rocket className="h-4 w-4" />
                    )}
                    {submitting ? "preparing…" : "pay & deploy"}
                  </button>
                </div>
                <p className="text-center text-[11px] text-muted-foreground">
                  backend wiring in progress · UI flow is final
                </p>
              </>
            )}
          </form>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}

function StepDot({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
          active || done
            ? "bg-accent text-accent-foreground"
            : "border border-border text-muted-foreground"
        }`}
      >
        {n}
      </span>
      <span className={active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </span>
  );
}

const cls =
  "mt-1 w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm outline-none transition focus:border-accent focus:bg-secondary/50";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-accent">{title}</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  full,
  hint,
  children,
}: {
  label: string;
  full?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                tabIndex={-1}
                className="inline-grid h-3.5 w-3.5 place-items-center rounded-full text-muted-foreground/70 hover:text-accent"
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
              {hint}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
      {children}
    </label>
  );
}

function NumberSuffix({
  value,
  onChange,
  suffix,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="relative mt-1">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cls + " mt-0 pr-14"}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-semibold text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

function ImageDrop({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const fileDialogOpenRef = useRef(false);
  const browseLockedUntilRef = useRef(0);

  useEffect(() => {
    const handleFocus = () => {
      if (!fileDialogOpenRef.current) return;
      browseLockedUntilRef.current = Date.now() + 1500;
      window.setTimeout(() => {
        fileDialogOpenRef.current = false;
      }, 1500);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const openFilePicker = () => {
    if (fileDialogOpenRef.current || Date.now() < browseLockedUntilRef.current) return;
    fileDialogOpenRef.current = true;
    browseLockedUntilRef.current = Number.POSITIVE_INFINITY;
    inputRef.current?.click();
  };

  const onFile = (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Image must be under 4MB");
      return;
    }
    const r = new FileReader();
    r.onload = () => onChange(String(r.result ?? ""));
    r.onerror = () => toast.error("Could not read file");
    r.readAsDataURL(file);
  };

  if (value) {
    return (
      <div className="mt-1 flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3">
        <img
          src={value}
          alt="preview"
          className="h-20 w-20 rounded-lg object-cover ring-1 ring-border"
        />
        <div className="flex-1 text-xs text-muted-foreground">
          image ready · uploads to pump.fun IPFS on deploy
        </div>
        <button
          type="button"
          onClick={() => onChange("")}
          className="rounded-md border border-border bg-background/40 p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive"
          title="Remove"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFile(e.dataTransfer.files?.[0]);
      }}
      role="button"
      tabIndex={0}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).tagName === "INPUT" || e.button !== 0) return;
        e.preventDefault();
        openFilePicker();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openFilePicker();
        }
      }}
      className={`mt-1 grid cursor-pointer place-items-center rounded-lg border-2 border-dashed p-8 text-center transition ${
        drag ? "border-accent bg-accent/10" : "border-border bg-secondary/20 hover:border-accent/60"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const f = e.target.files?.[0];
          browseLockedUntilRef.current = Date.now() + 1500;
          onFile(f);
          e.target.value = "";
        }}
      />
      <Upload className="h-6 w-6 text-muted-foreground" />
      <p className="mt-2 text-sm font-semibold">drop your coin image here</p>
      <p className="text-xs text-muted-foreground">or click to browse · png, jpg, gif · max 4MB</p>
    </div>
  );
}
