import { useState } from "react";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { useLaunchWallet, type LaunchWalletInfo } from "./WalletProvider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";


export function ConnectWalletButton({ className = "" }: { className?: string }) {
  const { wallets, select, connect, connected, publicKey, disconnect, connecting } = useLaunchWallet();
  const [open, setOpen] = useState(false);

  if (connected && publicKey) {
    const addr = publicKey.toBase58();
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        className={
          "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-accent/50 bg-accent/15 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent sm:px-3 " +
          className
        }
        title="Click to disconnect"
      >
        <Wallet className="h-3 w-3" />
        {addr.slice(0, 4)}…{addr.slice(-4)}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={connecting}
        className={
          "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-accent/50 bg-accent/15 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent hover:bg-accent/25 sm:px-3 " +
          className
        }
      >
        <Wallet className="h-3 w-3" />
        <span className="hidden sm:inline">{connecting ? "connecting…" : "connect wallet"}</span>
        <span className="sm:hidden">{connecting ? "…" : "connect"}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Connect a wallet</DialogTitle>
            <DialogDescription>
              Pick a Solana wallet to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {wallets.map((w: LaunchWalletInfo) => {
              const installed = w.readyState === "Installed" || (typeof window !== "undefined" && (
                (w.name === "Phantom" && ((window as any).phantom?.solana || (window as any).solana?.isPhantom)) ||
                (w.name === "Solflare" && (window as any).solflare)
              ));
              const isMobile = typeof navigator !== "undefined" &&
                /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
              return (
                <button
                  key={w.name}
                  type="button"
                  className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 px-3 py-3 text-sm hover:border-accent"
                  onClick={async () => {
                    try {
                      if (!installed) {
                        // On mobile, the wallet "extension" lives inside the
                        // wallet's own in-app browser. Deep-link there instead
                        // of telling users to install something they already have.
                        if (isMobile) {
                          const here = window.location.href;
                          const ref = window.location.origin;
                          const url = w.name === "Phantom"
                            ? `https://phantom.app/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(ref)}`
                            : `https://solflare.com/ul/v1/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(ref)}`;
                          window.location.href = url;
                          return;
                        }
                        window.open(w.installUrl, "_blank", "noopener,noreferrer");
                        toast.info(`${w.name} not detected — opening install page`);
                        return;
                      }
                      select(w.name);
                      await connect(w.name);
                      toast.success(`${w.name} connected`);
                      setOpen(false);
                    } catch (e: any) {
                      console.error("[wallet] connect failed", e);
                      toast.error(e?.message || `Failed to connect ${w.name}`);
                    }
                  }}
                >
                  {w.icon && (
                    <img src={w.icon} alt="" className="h-6 w-6" />
                  )}
                  <span className="font-semibold">{w.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {installed ? "Installed" : isMobile ? "Open in app" : "Not detected"}
                  </span>
                </button>
              );
            })}

          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
