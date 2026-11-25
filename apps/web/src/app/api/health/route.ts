import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { failoverConnection } from "@kekal/server";
import { runtimeCluster, webConfig, type RuntimeCluster } from "@/lib/config";
import { dataStore } from "@/lib/data";
import { buildHealth } from "@/lib/health";
import { relayerFundedCheck } from "@/lib/relay/funded";
import { relayerAddress } from "@/lib/relay/runtime";

export const dynamic = "force-dynamic";

let relayerFunded: (() => Promise<boolean | null>) | undefined;

function fundedCheck(cluster: RuntimeCluster): () => Promise<boolean | null> {
  relayerFunded ??= relayerFundedCheck({
    address: relayerAddress,
    getBalance: (a) =>
      failoverConnection({ urls: cluster.rpcUrls, timeoutMs: webConfig.rpc.timeoutMs, retryStatuses: webConfig.rpc.retryStatuses }).getBalance(
        new PublicKey(a),
      ),
    minLamports: Math.round(webConfig.health.relayerMinSol * LAMPORTS_PER_SOL),
    cacheMs: webConfig.health.balanceCacheSecs * 1000,
  });
  return relayerFunded;
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
  const health = await buildHealth(cluster, store, fundedCheck(cluster));
  return Response.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
