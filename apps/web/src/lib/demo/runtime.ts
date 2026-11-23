// Builds the demo dependencies from config/app.json + env. Kept apart from the service so tests need no keys.
import { readOnlyProgram } from "@kekal/sdk";
import {
  arbiterResolve,
  dyingShop,
  explorerTxUrl,
  failoverConnection,
  issueToHolder,
  loadKeypair,
  runtimeCluster,
  sellerRespond,
  type DemoChain,
  type RuntimeCluster,
} from "@kekal/server";
import { PublicKey } from "@solana/web3.js";
import { webConfig } from "../config";
import type { DemoOps } from "./service";

let cached: { cluster: RuntimeCluster; ops: DemoOps } | undefined;

/** Loaded once per process. Throws when a key or the demo mint is missing (routes answer 503 demo_unavailable). */
export function demoRuntime(): { cluster: RuntimeCluster; ops: DemoOps } {
  if (cached) return cached;
  const cluster = runtimeCluster();
  const mint = cluster.mints[0];
  if (!mint) throw new Error("no demo mint configured");
  const d = webConfig.demo;
  const conn = failoverConnection({ urls: cluster.rpcUrls, timeoutMs: webConfig.rpc.timeoutMs, retryStatuses: webConfig.rpc.retryStatuses });
  const chain: DemoChain = {
    conn,
    program: readOnlyProgram(conn, new PublicKey(cluster.programId)),
    mint: new PublicKey(mint),
    decimals: cluster.tokenDecimals,
    seller: loadKeypair(cluster.keysDir, d.sellerRole),
    arbiter: loadKeypair(cluster.keysDir, d.arbiterRole),
    feePayer: loadKeypair(cluster.keysDir, d.feePayerRole),
    settings: cluster.demo,
  };
  cached = {
    cluster,
    ops: {
      issue: (holder) => issueToHolder(chain, holder),
      dyingShop: (holder) => dyingShop(chain, holder),
      respond: (w, accept) => sellerRespond(chain, w, accept),
      resolve: (w, buyerWins) => arbiterResolve(chain, w, buyerWins),
    },
  };
  return cached;
}

export const demoExplorer = (cluster: RuntimeCluster) => (sig: string) => explorerTxUrl(cluster, sig);
