import { useState } from "react";
import { Wallet } from "lucide-react";
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
          "inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent " +
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
          "inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent hover:bg-accent/25 " +
          className
        }
      >
        <Wallet className="h-3 w-3" />
        {connecting ? "connecting…" : "connect wallet"}
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
            {wallets.map((w: LaunchWalletInfo) => (
              <button
                key={w.name}
                type="button"
                className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 px-3 py-3 text-sm hover:border-accent"
                onClick={async () => {
                  try {
                    if (w.readyState !== "Installed") {
                      window.open(w.installUrl, "_blank", "noopener,noreferrer");
                      return;
                    }
                    select(w.name);
                    await connect(w.name);
                    setOpen(false);
                  } catch (e) {
                    console.error(e);
                  }
                }}
              >
                {w.icon && (
                  <img src={w.icon} alt="" className="h-6 w-6" />
                )}
                <span className="font-semibold">{w.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {w.readyState}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
