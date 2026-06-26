import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Rocket,
  Search,
  ArrowLeft,
  Upload,
  X,
  Info,
  Loader2,
  Sparkles,
  Lock,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/liquititty-logo.webp";
import { getStats } from "@/lib/stats.functions";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { useLaunchWallet } from "@/components/WalletProvider";
import {
  buildFundingTx,
  slugify,
  type PrepareResult,
  type LaunchStatus,
} from "@/lib/launch-client";

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
          "Launch a self-refilling memecoin. The bot claims creator fees, buys back your token, redeposits the LP and burns the LP tokens.",
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
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border/60">
        <div className="relative mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-3 py-3 text-sm sm:px-4 sm:gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="shrink-0">
              <img src={logo} alt="liquititty" className="pf-wiggle h-8 w-8 rounded-md" />
            </Link>
            <nav className="hidden flex-wrap items-center gap-x-3 gap-y-1 md:flex">
              <Link to="/" className="pf-link">home</Link>
              <Link to="/coins" className="pf-link">all coins</Link>
              <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" className="pf-link">community</a>
              <button type="button" onClick={() => setHowOpen(true)} className="pf-link cursor-pointer">how it works</button>
            </nav>
          </div>
          <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 select-none font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 md:block">
            v0.1.0
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href={COMMUNITY_URL}
              target="_blank"
              rel="noreferrer"
              className="pf-shine hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent sm:inline-flex"
            >
              <Users className="h-3 w-3" /> community
            </a>
            <ConnectWalletButton />
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
        <div className="pt-10 text-center">
          <button type="button" onClick={openCreate} className="text-xl font-bold pf-link">
            start a new coin
          </button>
        </div>

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
                  <span className="font-bold text-accent">{fmtUsd(stats?.dex?.marketCapUsd)}</span>
                </div>
                <div className="text-muted-foreground">
                  liquidity:{" "}
                  <span className="font-bold text-foreground">{fmtUsd(stats?.dex?.liquidityUsd)}</span>
                </div>
                <div className="text-muted-foreground">
                  in LP:{" "}
                  <span className="text-foreground">{fmtNum(stats?.dex?.liquidityUsdc)} USDC</span> ·{" "}
                  <span className="text-foreground">{fmtNum(stats?.dex?.liquidityToken)} $LIQUITITTY</span>
                </div>
                <div className="mt-1 text-sm font-bold text-foreground group-hover:text-accent">
                  Liquititty <span className="font-normal text-muted-foreground">(ticker: $LIQUITITTY)</span>
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
          <Link
            to="/coins"
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground"
          >
            browse all
          </Link>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3 border-b border-border/60 pb-3 text-sm">
          <span className="font-bold text-accent">Terminal</span>
          <span className="text-muted-foreground">·</span>
          <SortPill label="bump order" active={sort === "bump"} onClick={() => setSort("bump")} />
          <SortPill label="newest" active={sort === "new"} onClick={() => setSort("new")} />
          <SortPill label="market cap" active={sort === "mcap"} onClick={() => setSort("mcap")} />
          <Link to="/coins" className="ml-auto text-xs text-accent hover:underline">
            view all launches →
          </Link>
        </div>

        <div className="mt-6 border border-dashed border-border bg-card/30 p-12 text-center text-sm">
          <Sparkles className="mx-auto h-6 w-6 text-accent" />
          <p className="mt-3 font-display text-xl">launches live on /coins</p>
          <p className="mt-2 text-muted-foreground">
            every coin launched here auto-refills its own LP on PumpSwap.
          </p>
          <Link to="/coins" className="mt-4 inline-block pf-link font-bold">
            see all launches →
          </Link>
        </div>
      </main>

      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <div>liquititty.fun · built on solana · auto-LP on pumpswap</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">v0.1.0</div>
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

function fmtNum(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  if (a >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
function fmtUsd(n: number | null | undefined) {
  return n == null || !Number.isFinite(n) ? "—" : `$${fmtNum(n)}`;
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
          <ol className="space-y-3 text-sm">
            <Step n={1} title="Claim creator rewards">
              The bot claims USDC creator fees accumulated on your pump.fun coin.
            </Step>
            <Step n={2} title="Treasury fee">
              A small slice goes to the Liquititty treasury — that's how the platform stays alive.
            </Step>
            <Step n={3} title="Buy back into your token">
              ~35% of remaining USDC is swapped into your coin via Jupiter.
            </Step>
            <Step n={4} title="Add 100% to the PumpSwap LP">
              The bought tokens + matching USDC are deposited into your PumpSwap LP.
            </Step>
            <Step n={5} title="Burn the LP tokens">
              LP tokens are burned. Liquidity is locked forever.
            </Step>
            <Step n={6} title="Repeat">
              Forever.
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
   LAUNCH FLOW
   ============================================================ */
type Form = {
  name: string;
  symbol: string;
  description: string;
  imageFile: File | null;
  imagePreview: string;
  website: string;
  twitter: string;
  telegram: string;
  initialBuyUsdc: number;
};

const DEFAULT_FORM: Form = {
  name: "",
  symbol: "",
  description: "",
  imageFile: null,
  imagePreview: "",
  website: "",
  twitter: "",
  telegram: "",
  initialBuyUsdc: 10,
};

type FlowPhase =
  | "form"
  | "uploading"
  | "preparing"
  | "confirm_fund"
  | "signing"
  | "polling"
  | "launched"
  | "error";

function CreateCoinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [step, setStep] = useState<1 | 2>(1);
  const [phase, setPhase] = useState<FlowPhase>("form");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [prepare, setPrepare] = useState<PrepareResult | null>(null);
  const [fundSig, setFundSig] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<LaunchStatus | null>(null);
  const update = (k: keyof Form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const { getConnection, publicKey, signTransaction, connected } = useLaunchWallet();
  const navigate = useNavigate();

  function reset() {
    setForm(DEFAULT_FORM);
    setStep(1);
    setPhase("form");
    setErrorMsg(null);
    setPrepare(null);
    setFundSig(null);
    setStatusInfo(null);
  }

  async function uploadMetadata(): Promise<{ metadataUri: string; imageUrl: string }> {
    if (!form.imageFile) throw new Error("Image is required");
    const fd = new FormData();
    fd.append("file", form.imageFile);
    fd.append("name", form.name);
    fd.append("symbol", form.symbol);
    fd.append("description", form.description);
    if (form.twitter) fd.append("twitter", form.twitter);
    if (form.telegram) fd.append("telegram", form.telegram);
    if (form.website) fd.append("website", form.website);

    const r = await fetch("/api/launch/upload", { method: "POST", body: fd });
    if (!r.ok) {
      const t = await r.text();
      throw new Error("Metadata upload failed: " + t);
    }
    const j = await r.json();
    // pump.fun returns { metadata: {...}, metadataUri: "...", ... } in various shapes.
    const metadataUri = j.metadataUri ?? j.uri ?? j.metadata_uri;
    const imageUrl = j.metadata?.image ?? j.image ?? "";
    if (!metadataUri) throw new Error("No metadataUri from upload");
    return { metadataUri, imageUrl };
  }

  async function callPrepare(args: {
    metadataUri: string;
    imageUrl: string;
  }): Promise<PrepareResult> {
    if (!publicKey) throw new Error("Wallet not connected");
    const slug = slugify(form.symbol || form.name);
    const body = {
      name: form.name,
      symbol: form.symbol,
      slug,
      description: form.description,
      imageUrl: args.imageUrl,
      websiteUrl: form.website || null,
      twitterUrl: form.twitter || null,
      telegramUrl: form.telegram || null,
      metadataUri: args.metadataUri,
      deployerWallet: publicKey.toBase58(),
      initialBuyUsdc: form.initialBuyUsdc,
    };
    const r = await fetch("/api/launch/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await r.text();
    if (!r.ok) {
      let detail = raw;
      try {
        const j = JSON.parse(raw);
        detail = j.error || j.message || j.detail || raw;
      } catch {}
      throw new Error(`Prepare failed (${r.status}): ${detail || "no response body"}`);
    }
    try {
      return JSON.parse(raw) as PrepareResult;
    } catch {
      throw new Error(`Prepare failed: invalid JSON response — ${raw.slice(0, 200)}`);
    }
  }

  async function onPrepareSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!connected || !publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    if (!form.name || !form.symbol) {
      toast.error("Name and symbol required");
      return;
    }
    if (!form.imageFile) {
      toast.error("Image required");
      return;
    }
    if (!(form.initialBuyUsdc >= 0)) {
      toast.error("Initial buy must be ≥ 0");
      return;
    }

    try {
      setPhase("uploading");
      const meta = await uploadMetadata();
      setPhase("preparing");
      const prep = await callPrepare(meta);
      setPrepare(prep);
      setPhase("confirm_fund");
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  async function onSignFunding() {
    if (!prepare || !publicKey || !signTransaction) return;
    try {
      setPhase("signing");
      const connection = await getConnection();
      const tx = await buildFundingTx({
        connection,
        payer: publicKey.toBase58(),
        devWallet: prepare.devWallet,
        usdcAmount: prepare.fund.usdc,
        solAmount: prepare.fund.sol,
        usdcMint: prepare.fund.usdcMint,
      });
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      setFundSig(sig);
      toast.success("Funding tx sent");
      await connection.confirmTransaction(sig, "confirmed");
      setPhase("polling");
      pollStatus(prepare.pendingId);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message ?? "Sign/send failed");
      setPhase("error");
    }
  }

  async function pollStatus(pendingId: string) {
    const deadline = Date.now() + 10 * 60_000; // 10 min cap
    while (Date.now() < deadline) {
      try {
        const r = await fetch(
          `/api/launch/status?id=${encodeURIComponent(pendingId)}`,
        );
        if (r.ok) {
          const j = (await r.json()) as LaunchStatus;
          setStatusInfo(j);
          if (j.status === "launched" && j.mint) {
            setPhase("launched");
            toast.success("Coin launched!");
            setTimeout(() => {
              onClose();
              navigate({ to: "/coin/$mint", params: { mint: j.mint! } });
            }, 1500);
            return;
          }
          if (j.status === "failed") {
            setErrorMsg(j.error || "Launch failed");
            setPhase("error");
            return;
          }
        }
      } catch (e) {
        console.error(e);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    setErrorMsg("Timed out waiting for launch");
    setPhase("error");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          // Don't blow away in-flight launch state
          if (phase === "form" || phase === "launched" || phase === "error") {
            reset();
          }
        }
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {phase === "launched"
              ? "Launched 🎉"
              : phase === "confirm_fund"
              ? "Confirm funding"
              : phase === "polling"
              ? "Launching…"
              : step === 1
              ? "Launch your coin"
              : "Initial buy & auto-LP"}
          </DialogTitle>
          <DialogDescription>
            {phase === "form"
              ? step === 1
                ? "Token metadata — exactly what gets minted on pump.fun (USDC pair)."
                : "How much should the dev wallet pre-buy with at deploy?"
              : "Hang tight while we set up your launch."}
          </DialogDescription>
        </DialogHeader>

        {phase === "form" && (
          <>
            <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <StepDot active={step === 1} done={step > 1} n={1} label="Token" />
              <span className="h-px flex-1 bg-border" />
              <StepDot active={step === 2} done={false} n={2} label="Deploy" />
            </div>

            <TooltipProvider delayDuration={150}>
              <form onSubmit={onPrepareSubmit} className="mt-4 space-y-5">
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
                      <Field label="Symbol">
                        <input
                          className={cls}
                          value={form.symbol}
                          onChange={(e) => update("symbol", e.target.value.toUpperCase())}
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
                        <ImageDrop
                          preview={form.imagePreview}
                          onChange={(file, preview) => {
                            update("imageFile", file);
                            update("imagePreview", preview);
                          }}
                        />
                      </Field>
                    </Section>

                    <Section title="Links (optional)">
                      <Field label="Twitter / X" full>
                        <input
                          className={cls}
                          value={form.twitter}
                          onChange={(e) => update("twitter", e.target.value)}
                          placeholder="https://x.com/yourhandle"
                        />
                      </Field>
                      <Field label="Telegram" full>
                        <input
                          className={cls}
                          value={form.telegram}
                          onChange={(e) => update("telegram", e.target.value)}
                          placeholder="https://t.me/yourgroup"
                        />
                      </Field>
                      <Field label="Website" full>
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
                          if (!form.name || !form.symbol) {
                            toast.error("Name and symbol required");
                            return;
                          }
                          if (!form.imageFile) {
                            toast.error("Image required");
                            return;
                          }
                          setStep(2);
                        }}
                        className="rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-accent-foreground transition hover:scale-105"
                      >
                        next: deploy →
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <Section title="Auto-LP rules (locked)">
                      <div className="md:col-span-2 mb-1 flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-[11px] text-accent">
                        <Lock className="h-3 w-3" /> beta — every coin runs the same loop: 35% buyback, 10% treasury fee, every cycle.
                      </div>
                    </Section>

                    <Section title="Deployment">
                      <Field
                        label="Initial buy (USDC)"
                        hint="USDC amount the dev wallet pre-buys with on launch. You'll fund this in the next step."
                        full
                      >
                        <NumberSuffix
                          value={form.initialBuyUsdc}
                          onChange={(v) => update("initialBuyUsdc", Math.max(0, v))}
                          suffix="USDC"
                          min={0}
                          step={1}
                        />
                      </Field>
                    </Section>

                    {!connected && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                        Connect your wallet first — it's the deployer & receives nothing back (custodial dev wallet runs the bot).
                      </div>
                    )}

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
                        disabled={!connected}
                        className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-accent-foreground transition hover:scale-105 disabled:opacity-50"
                      >
                        <Rocket className="h-4 w-4" />
                        prepare launch
                      </button>
                    </div>
                  </>
                )}
              </form>
            </TooltipProvider>
          </>
        )}

        {(phase === "uploading" || phase === "preparing") && (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
            <div className="mt-4 text-sm font-semibold">
              {phase === "uploading" ? "Uploading image & metadata…" : "Preparing dev wallet…"}
            </div>
          </div>
        )}

        {phase === "confirm_fund" && prepare && (
          <div className="space-y-4">
            <div className="rounded-md border border-accent/40 bg-accent/10 p-4 text-sm">
              <div className="font-bold uppercase tracking-wider text-accent text-xs">You'll send</div>
              <div className="mt-2 text-lg font-bold">
                {prepare.fund.usdc} USDC + {prepare.fund.sol} SOL
              </div>
              <div className="mt-1 break-all text-[10px] text-muted-foreground">
                to dev wallet {prepare.devWallet}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                One transaction. The dev wallet then deploys your coin, performs the initial buy,
                and runs the auto-LP loop forever.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPhase("form");
                  setPrepare(null);
                }}
                className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:bg-secondary/40"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={onSignFunding}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-accent-foreground transition hover:scale-105"
              >
                <Rocket className="h-4 w-4" /> approve & fund
              </button>
            </div>
          </div>
        )}

        {phase === "signing" && (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
            <div className="mt-4 text-sm font-semibold">Approve in your wallet…</div>
          </div>
        )}

        {phase === "polling" && (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
            <div className="mt-4 text-sm font-semibold">
              {statusInfo?.status
                ? `status: ${statusInfo.status}`
                : "waiting for backend…"}
            </div>
            {fundSig && (
              <a
                className="mt-3 inline-block text-xs text-accent hover:underline"
                href={`https://solscan.io/tx/${fundSig}`}
                target="_blank"
                rel="noreferrer"
              >
                view funding tx ↗
              </a>
            )}
            <div className="mt-4 flex justify-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              <PhasePill label="awaiting_funds" current={statusInfo?.status} />
              <PhasePill label="funded" current={statusInfo?.status} />
              <PhasePill label="executing" current={statusInfo?.status} />
              <PhasePill label="launched" current={statusInfo?.status} />
            </div>
          </div>
        )}

        {phase === "launched" && (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-accent" />
            <div className="mt-3 text-lg font-bold">Coin launched!</div>
            <div className="text-sm text-muted-foreground">redirecting to coin page…</div>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3 py-6">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMsg ?? "Unknown error"}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold hover:bg-secondary/40"
              >
                start over
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PhasePill({ label, current }: { label: string; current?: string }) {
  const active = current === label;
  return (
    <span
      className={`rounded-full px-2 py-0.5 ${
        active ? "bg-accent text-accent-foreground" : "border border-border"
      }`}
    >
      {label}
    </span>
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
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className="relative mt-1">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cls + " mt-0 pr-14 disabled:cursor-not-allowed disabled:opacity-50"}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-semibold text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

function ImageDrop({
  preview,
  onChange,
}: {
  preview: string;
  onChange: (file: File | null, preview: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

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
    r.onload = () => onChange(file, String(r.result ?? ""));
    r.onerror = () => toast.error("Could not read file");
    r.readAsDataURL(file);
  };

  if (preview) {
    return (
      <div className="mt-1 flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3">
        <img src={preview} alt="preview" className="h-20 w-20 rounded-lg object-cover ring-1 ring-border" />
        <div className="flex-1 text-xs text-muted-foreground">
          image ready · uploads on deploy
        </div>
        <button
          type="button"
          onClick={() => onChange(null, "")}
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
      onClick={(e) => {
        // Field wraps us in a <label>; prevent the label's native click from
        // also opening the file picker (double-open closes the first one).
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.click();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
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
        onChange={(e) => {
          const f = e.target.files?.[0];
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
