import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { failoverConnection, loadKeypair } from "@kekal/server";
import { runtimeCluster, webConfig, type RuntimeCluster } from "@/lib/config";
import { dataStore } from "@/lib/data";
import { buildHealth } from "@/lib/health";
import { fundsCheck, type Funds } from "@/lib/relay/funded";
import { relayerAddress } from "@/lib/relay/runtime";

export const dynamic = "force-dynamic";

let funds: (() => Promise<Funds>) | undefined;

let sellerAddress: string | null | undefined;
function demoSellerAddress(cluster: RuntimeCluster): string | null {
  if (sellerAddress !== undefined) return sellerAddress;
  try {
    sellerAddress = loadKeypair(cluster.keysDir, webConfig.demo.sellerRole).publicKey.toBase58();
  } catch {
    sellerAddress = null;
  }
  return sellerAddress;
}

function fundsFor(cluster: RuntimeCluster): () => Promise<Funds> {
  const lamports = (sol: number) => Math.round(sol * LAMPORTS_PER_SOL);
  const h = webConfig.health;
  funds ??= fundsCheck({
    addresses: () => ({ demoSeller: demoSellerAddress(cluster), relayer: relayerAddress() }),
    getBalances: async (list) => {
      const conn = failoverConnection({ urls: cluster.rpcUrls, timeoutMs: webConfig.rpc.timeoutMs, retryStatuses: webConfig.rpc.retryStatuses });
      const infos = await conn.getMultipleAccountsInfo(list.map((a) => new PublicKey(a)));
      return infos.map((i) => i?.lamports ?? 0);
    },
    runCostLamports: { demoSeller: lamports(h.runCostSol.demoSeller), relayer: lamports(h.runCostSol.relayer) },
    relayerMinLamports: lamports(h.relayerMinSol),
    cacheMs: h.balanceCacheSecs * 1000,
  });
  return funds;
}

export async function GET(): Promise<Response> {
  let store;
  try {
    store = dataStore();
  } catch (e) {
    console.error("health: data store", (e as Error).message);
    store = e as Error;
  }
  const cluster = runtimeCluster();
  const health = await buildHealth(cluster, store, fundsFor(cluster));
  return Response.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
