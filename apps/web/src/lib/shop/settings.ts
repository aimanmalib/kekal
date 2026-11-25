// Settings the /kedai and /timbang pages hand to their client boards: config/app.json + the runtime cluster.
import { appConfig, clusterSettings } from "@kekal/server";
import type { BoardSettings } from "@/components/kedai/ShopBoard";
import type { ArbiterSettings } from "@/components/timbang/ArbiterBoard";
import { runtimeCluster, webConfig } from "../config";
import { chainId } from "../wallet/chain";

/** Allowed mints with their config names (kusd, usdc); a mint only given through env shows its address. */
export function mintChoices(clusterName: string, mints: string[]): { name: string; address: string }[] {
  const named = Object.entries(clusterSettings(clusterName).mints as Record<string, string | null>);
  return mints.map((address) => ({ name: named.find(([, a]) => a === address)?.[0].toUpperCase() ?? address, address }));
}

export function boardSettings(): BoardSettings {
  const cluster = runtimeCluster();
  const b = webConfig.shopBoard;
  const w = webConfig.warrantyPage;
  return {
    chain: chainId(cluster.name),
    demoOpen: cluster.deployed,
    currency: webConfig.currency,
    mints: mintChoices(cluster.name, cluster.mints),
    windows: b.windows,
    termMonths: b.termMonths,
    defaultTermMonths: b.defaultTermMonths,
    secsPerMonth: b.secsPerMonth,
    reserve: b.reserve,
    promise: appConfig.demoTerms.promise,
    max: { product: b.productMaxChars, serial: b.serialMaxChars, promise: b.promiseMaxChars, reason: b.reasonMaxChars },
    pollMs: b.pollMs,
    confirmPollMs: w.confirmPollMs,
    confirmTimeoutMs: w.confirmTimeoutMs,
    keyFragment: w.keyFragment,
    explorerTx: cluster.explorerTx,
    card: b.card,
  };
}

export function arbiterSettings(): ArbiterSettings {
  const cluster = runtimeCluster();
  const w = webConfig.warrantyPage;
  return {
    chain: chainId(cluster.name),
    demoOpen: cluster.deployed,
    currency: webConfig.currency,
    pollMs: webConfig.shopBoard.pollMs,
    confirmPollMs: w.confirmPollMs,
    confirmTimeoutMs: w.confirmTimeoutMs,
    explorerTx: cluster.explorerTx,
  };
}
