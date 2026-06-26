import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Connection, Transaction } from "@solana/web3.js";
import { loadWeb3 } from "@/lib/solana-client";

const RPC =
  (import.meta as any).env?.VITE_HELIUS_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

type WalletName = "Phantom" | "Solflare";
type ReadyState = "Installed" | "Not detected";

type BrowserWallet = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: unknown;
  icon?: string;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: unknown } | void>;
  disconnect?: () => Promise<void> | void;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  off?: (event: string, handler: (...args: any[]) => void) => void;
};

export type WalletPublicKey = {
  toBase58: () => string;
  toString: () => string;
};

export type LaunchWalletInfo = {
  name: WalletName;
  readyState: ReadyState;
  icon?: string;
  installUrl: string;
};

type LaunchWalletContextValue = {
  wallets: LaunchWalletInfo[];
  walletName: WalletName | null;
  publicKey: WalletPublicKey | null;
  connected: boolean;
  connecting: boolean;
  getConnection: () => Promise<Connection>;
  select: (name: WalletName) => void;
  connect: (name?: WalletName) => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};

const STORAGE_KEY = "liquititty.wallet";
const INSTALL_URLS: Record<WalletName, string> = {
  Phantom: "https://phantom.app/",
  Solflare: "https://solflare.com/",
};

const DEFAULT_WALLETS: LaunchWalletInfo[] = [
  { name: "Phantom", readyState: "Not detected", installUrl: INSTALL_URLS.Phantom },
  { name: "Solflare", readyState: "Not detected", installUrl: INSTALL_URLS.Solflare },
];

const LaunchWalletContext = createContext<LaunchWalletContextValue | null>(null);

function getInjectedWallet(name: WalletName): BrowserWallet | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  if (name === "Phantom") {
    return w.phantom?.solana?.isPhantom
      ? w.phantom.solana
      : w.solana?.isPhantom
        ? w.solana
        : null;
  }
  if (name === "Solflare") {
    return w.solflare?.isSolflare ? w.solflare : null;
  }
  return null;
}

function detectWallets(): LaunchWalletInfo[] {
  return DEFAULT_WALLETS.map((wallet) => {
    const provider = getInjectedWallet(wallet.name);
    return {
      ...wallet,
      readyState: provider ? "Installed" : "Not detected",
      icon: provider?.icon,
    };
  });
}

function normalizePublicKey(value: unknown): WalletPublicKey | null {
  if (!value) return null;
  const asAny = value as any;
  const text =
    typeof value === "string"
      ? value
      : typeof asAny.toBase58 === "function"
        ? asAny.toBase58()
        : typeof asAny.toString === "function"
          ? asAny.toString()
          : "";
  if (!text) return null;
  return { toBase58: () => text, toString: () => text };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<LaunchWalletInfo[]>(DEFAULT_WALLETS);
  const [walletName, setWalletName] = useState<WalletName | null>(null);
  const [publicKey, setPublicKey] = useState<WalletPublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);

  const getConnection = useCallback(async () => {
    const { Connection } = await loadWeb3();
    return new Connection(RPC, "confirmed");
  }, []);

  const select = useCallback((name: WalletName) => {
    setWalletName(name);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, name);
    }
  }, []);

  const connect = useCallback(
    async (name?: WalletName) => {
      const nextName = name ?? walletName ?? "Phantom";
      const provider = getInjectedWallet(nextName);
      if (!provider) throw new Error(`${nextName} wallet is not installed`);

      setConnecting(true);
      try {
        const response = await provider.connect();
        const nextPublicKey = normalizePublicKey(response?.publicKey ?? provider.publicKey);
        if (!nextPublicKey) throw new Error(`${nextName} did not return a public key`);
        setWalletName(nextName);
        setPublicKey(nextPublicKey);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY, nextName);
        }
      } finally {
        setConnecting(false);
      }
    },
    [walletName],
  );

  const disconnect = useCallback(async () => {
    const provider = walletName ? getInjectedWallet(walletName) : null;
    await provider?.disconnect?.();
    setPublicKey(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [walletName]);

  const signTransaction = useCallback(
    async (tx: Transaction) => {
      const provider = walletName ? getInjectedWallet(walletName) : null;
      if (!provider?.signTransaction) {
        throw new Error(`${walletName ?? "Wallet"} cannot sign transactions`);
      }
      return provider.signTransaction(tx);
    },
    [walletName],
  );

  useEffect(() => {
    const refresh = () => setWallets(detectWallets());
    refresh();

    const saved = window.localStorage.getItem(STORAGE_KEY) as WalletName | null;
    if (saved === "Phantom" || saved === "Solflare") {
      setWalletName(saved);
      const provider = getInjectedWallet(saved);
      const pk = normalizePublicKey(provider?.publicKey);
      if (pk) setPublicKey(pk);
    }

    window.addEventListener("load", refresh);
    const timer = window.setTimeout(refresh, 750);
    return () => {
      window.removeEventListener("load", refresh);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const provider = walletName ? getInjectedWallet(walletName) : null;
    if (!provider?.on) return;
    const handleAccountChanged = (nextPublicKey: unknown) => {
      setPublicKey(normalizePublicKey(nextPublicKey ?? provider.publicKey));
    };
    const handleDisconnect = () => setPublicKey(null);
    provider.on("accountChanged", handleAccountChanged);
    provider.on("disconnect", handleDisconnect);
    return () => {
      provider.off?.("accountChanged", handleAccountChanged);
      provider.off?.("disconnect", handleDisconnect);
    };
  }, [walletName]);

  const value = useMemo<LaunchWalletContextValue>(
    () => ({
      wallets,
      walletName,
      publicKey,
      connected: Boolean(publicKey),
      connecting,
      getConnection,
      select,
      connect,
      disconnect,
      signTransaction,
    }),
    [wallets, walletName, publicKey, connecting, getConnection, select, connect, disconnect, signTransaction],
  );

  return (
    <LaunchWalletContext.Provider value={value}>
      {children}
    </LaunchWalletContext.Provider>
  );
}

export function useLaunchWallet() {
  const ctx = useContext(LaunchWalletContext);
  if (!ctx) throw new Error("useLaunchWallet must be used inside WalletProvider");
  return ctx;
}
