import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Rocket, Loader2, Upload, X, Info } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const Route = createFileRoute("/launch/create")({
  component: CreatePage,
  ssr: false,
  head: () => ({ meta: [{ title: "Create a coin — Liquititty Launchpad" }] }),
});

// Payload shape — mirrors the airdrop-launchpad create flow so the backend
// engineer can wire `POST /api/public/create-launch` with action=prepare /
// finalize against this exact schema.
type Form = {
  name: string;
  ticker: string;
  description: string;
  image_url: string;
  twitter: string;
  telegram: string;
  website: string;
  total_supply: number;
  // auto-LP config — the liquititty loop
  buyback_pct: number;             // % of claimed USDC fees swapped back into the token
  cycle_interval_seconds: number;  // how often the bot runs the loop
  min_claim_usdc: number;          // skip a cycle if claimable USDC < this
  initial_sol_buy: number;         // SOL spent on the pump.fun bonding curve at deploy
};

const DEFAULT: Form = {
  name: "",
  ticker: "",
  description: "",
  image_url: "",
  twitter: "",
  telegram: "",
  website: "",
  total_supply: 1_000_000_000,
  buyback_pct: 35,
  cycle_interval_seconds: 60,
  min_claim_usdc: 1,
  initial_sol_buy: 0.5,
};

const SERVICE_FEE_SOL = 0.05;
const NETWORK_FEE_SOL = 0.01;
const MAX_INITIAL_BUY_SOL = 87;

function pct(part: number, whole: number) {
  if (!whole) return "0%";
  const p = (part / whole) * 100;
  return p >= 10 ? `${p.toFixed(1)}%` : `${p.toFixed(2)}%`;
}

const cls = "mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none";

function CreatePage() {
  const [form, setForm] = useState<Form>(DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const update = (k: keyof Form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.ticker) {
      toast.error("Name and ticker required");
      return;
    }
    setSubmitting(true);
    // UI-only for now — backend wires later. We log the exact payload the
    // backend should receive so wiring is a one-liner.
    console.log("[liquititty] create-launch payload:", form);
    await new Promise((r) => setTimeout(r, 1200));
    toast.success("Launch flow ready — backend wiring in progress");
    setSubmitting(false);
    navigate({ to: "/launch" });
  }

  const total = (form.initial_sol_buy || 0) + SERVICE_FEE_SOL + NETWORK_FEE_SOL;

  return (
    <div className="pf-theme min-h-screen">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 text-sm">
          <Link to="/launch" className="font-bold text-primary">liquititty.fun · launchpad</Link>
          <Link to="/launch" className="pf-link text-xs">browse coins</Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link to="/launch" className="mb-4 inline-flex items-center gap-1.5 text-xs pf-link">
          <ArrowLeft className="h-3 w-3" /> back
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">launch your auto-LP coin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Deploys on pump.fun (USDC quote). The Liquititty bot claims creator fees,
          buys {form.buyback_pct}% back into your coin, and redeposits into the
          PumpSwap LP — every {form.cycle_interval_seconds}s, forever.
        </p>

        <TooltipProvider delayDuration={150}>
          <form onSubmit={onSubmit} className="mt-8 space-y-6">
            <Section title="Token">
              <Field label="Name">
                <input className={cls} value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="My Awesome Coin" />
              </Field>
              <Field label="Ticker">
                <input className={cls} value={form.ticker} onChange={(e) => update("ticker", e.target.value.toUpperCase())} placeholder="AWESOME" maxLength={10} />
              </Field>
              <Field label="Description" full>
                <textarea className={cls + " min-h-20"} value={form.description} onChange={(e) => update("description", e.target.value)} />
              </Field>
              <Field label="Image" full>
                <ImageDrop value={form.image_url} onChange={(v) => update("image_url", v)} />
              </Field>
              <Field
                label="Twitter / X (optional)"
                hint="Must be a full link on x.com or twitter.com — pump.fun rejects anything else. Leave empty if you don't have one."
              >
                <input className={cls} value={form.twitter} onChange={(e) => update("twitter", e.target.value)} placeholder="https://x.com/yourhandle" />
              </Field>
              <Field label="Telegram (optional)" hint="Must be a full t.me link. Leave empty if none.">
                <input className={cls} value={form.telegram} onChange={(e) => update("telegram", e.target.value)} placeholder="https://t.me/yourgroup" />
              </Field>
              <Field label="Website (optional)" full hint="Full https:// URL or leave empty.">
                <input className={cls} value={form.website} onChange={(e) => update("website", e.target.value)} placeholder="https://example.com" />
              </Field>
            </Section>

            <Section title="Auto-LP rules">
              <Field
                label="Buyback %"
                hint="Share of the USDC creator fees the bot swaps back into your token before redepositing LP. Liquititty default is 35% — leaves enough USDC quote to keep the LP perfectly paired."
              >
                <div className="relative mt-1">
                  <input
                    type="number"
                    min={5}
                    max={95}
                    step={1}
                    className={cls + " mt-0 pr-10"}
                    value={form.buyback_pct}
                    onChange={(e) => update("buyback_pct", Number(e.target.value))}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">%</span>
                </div>
              </Field>
              <Field
                label="Cycle interval (seconds)"
                hint="How often the bot fires the loop: claim → buy → add LP → burn LP tokens."
              >
                <input
                  type="number"
                  min={30}
                  step={30}
                  className={cls}
                  value={form.cycle_interval_seconds}
                  onChange={(e) => update("cycle_interval_seconds", Number(e.target.value))}
                />
              </Field>
              <Field
                label="Min claimable USDC"
                hint="Skip the cycle if claimable fees are below this. Avoids burning gas on dust."
                full
              >
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className={cls}
                  value={form.min_claim_usdc}
                  onChange={(e) => update("min_claim_usdc", Number(e.target.value))}
                />
              </Field>
            </Section>

            <Section title="Deployment">
              <Field
                label="Initial buy (SOL)"
                hint={`SOL spent by our protocol wallet at launch to seed the pump.fun bonding curve. Capped at ${MAX_INITIAL_BUY_SOL} SOL (curve migration cap).`}
                full
              >
                <div className="relative mt-1">
                  <input
                    type="number"
                    min={0}
                    max={MAX_INITIAL_BUY_SOL}
                    step={0.01}
                    className={cls + " mt-0 pr-20"}
                    value={form.initial_sol_buy}
                    onChange={(e) => update("initial_sol_buy", Math.min(MAX_INITIAL_BUY_SOL, Math.max(0, Number(e.target.value))))}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-muted-foreground">SOL</span>
                </div>
              </Field>

              <div className="col-span-full rounded-md border border-border bg-secondary/50 p-3 text-xs">
                <div className="mb-2 font-semibold text-foreground">You'll pay {total.toFixed(3)} SOL total</div>
                <Row label="pump.fun initial buy" value={`${form.initial_sol_buy.toFixed(3)} SOL`} />
                <Row label="solana network fee" value={`${NETWORK_FEE_SOL.toFixed(3)} SOL`} muted />
                <Row label="liquititty service fee" value={`${SERVICE_FEE_SOL.toFixed(3)} SOL`} muted />
                <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
                  <span>total charged</span>
                  <span className="text-primary">{total.toFixed(3)} SOL</span>
                </div>
              </div>

              <div className="col-span-full rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
                <div className="font-bold uppercase tracking-wider text-primary">how the loop works</div>
                <div className="mt-1 text-muted-foreground">
                  Every {form.cycle_interval_seconds}s, our bot claims USDC creator fees on your coin,
                  swaps {form.buyback_pct}% of that USDC into your token via Jupiter, then deposits
                  100% token + matching USDC into the PumpSwap LP. LP tokens are burned. You can't
                  rug it, we can't rug it — the LP only grows.
                </div>
              </div>
            </Section>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {submitting ? "preparing launch…" : "pay & deploy"}
            </button>
            <p className="text-center text-[11px] text-muted-foreground">
              backend wiring in progress · UI flow is final
            </p>
          </form>
        </TooltipProvider>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary">{title}</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({ label, full, hint, children }: { label: string; full?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? "md:col-span-2" : ""}`}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" tabIndex={-1} className="inline-grid h-3.5 w-3.5 place-items-center rounded-full text-muted-foreground/70 hover:text-primary">
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">{hint}</TooltipContent>
          </Tooltip>
        )}
      </span>
      {children}
    </label>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 py-0.5 ${muted ? "text-muted-foreground" : "text-foreground"}`}>
      <span className="truncate">{label}</span>
      <span className="font-mono shrink-0">{value}</span>
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
      window.setTimeout(() => { fileDialogOpenRef.current = false; }, 1500);
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
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image"); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error("Image must be under 4MB"); return; }
    const r = new FileReader();
    r.onload = () => onChange(String(r.result ?? ""));
    r.onerror = () => toast.error("Could not read file");
    r.readAsDataURL(file);
  };

  if (value) {
    return (
      <div className="mt-1 flex items-center gap-3 rounded-md border border-border bg-input/40 p-3">
        <img src={value} alt="preview" className="h-20 w-20 rounded-md object-cover ring-1 ring-border" />
        <div className="flex-1 text-xs text-muted-foreground">image ready · uploads to pump.fun IPFS on deploy</div>
        <button
          type="button"
          onClick={() => onChange("")}
          className="rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive"
          title="Remove"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
      role="button"
      tabIndex={0}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).tagName === "INPUT" || e.button !== 0) return;
        e.preventDefault();
        openFilePicker();
      }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFilePicker(); } }}
      className={`mt-1 grid cursor-pointer place-items-center rounded-md border-2 border-dashed p-8 text-center transition ${
        drag ? "border-primary bg-primary/5" : "border-border bg-input/30 hover:border-primary/60"
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

// helper to silence unused import in case `pct` lint complains
void pct;
