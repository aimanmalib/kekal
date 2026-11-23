"use client";

import { useCallback, useEffect, useState } from "react";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { connectWallet, disconnectWallet, onWalletsChanged, usableWallets } from "@/lib/wallet/standard";

export interface Connected {
  wallet: Wallet;
  account: WalletAccount;
}

/** Wallets present in this browser for `chain`, and the one the visitor connected (kept in memory only). */
export function useWallet(chain: string) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const read = () => setWallets(usableWallets(chain));
    read();
    return onWalletsChanged(read);
  }, [chain]);

  const connect = useCallback(async (wallet: Wallet) => {
    setFailed(false);
    try {
      setConnected({ wallet, account: await connectWallet(wallet) });
    } catch {
      setFailed(true);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (connected) await disconnectWallet(connected.wallet);
    setConnected(null);
  }, [connected]);

  return { wallets, connected, connect, disconnect, failed };
}
