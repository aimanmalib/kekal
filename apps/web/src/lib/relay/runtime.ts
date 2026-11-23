// Builds the relay dependencies from config/app.json + env. Kept apart from the pure policy so tests need no keys.
import { PublicKey, type Keypair, type VersionedTransaction } from "@solana/web3.js";
import { runtimeCluster, webConfig, type RuntimeCluster } from "../config";
import { loadKeypair } from "../keys";
import { forwardWithFailover, type FailoverOptions } from "../rpc-proxy";
import type { RelayPolicy } from "./policy";

export function relayPolicy(cluster: RuntimeCluster, relayer: PublicKey): RelayPolicy {
  const c = webConfig.relay;
  return {
    programId: new PublicKey(cluster.programId),
    relayer,
    allowedMints: cluster.mints.map((m) => new PublicKey(m)),
    allowedInstructions: c.allowedInstructions,
    payerAccounts: c.payerAccounts,
    maxInstructions: c.maxInstructions,
    maxAccountCreates: c.maxAccountCreates,
    maxTxBytes: c.maxTxBytes,
  };
}

/** JSON-RPC sendTransaction through the same failover list as /api/rpc. Resubmitting the same signed bytes is safe. */
export function rpcSender(opts: FailoverOptions, preflightCommitment: string) {
  return async (tx: VersionedTransaction): Promise<string> => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [Buffer.from(tx.serialize()).toString("base64"), { encoding: "base64", preflightCommitment }],
    });
    const up = await forwardWithFailover(payload, opts);
    let parsed: { result?: unknown; error?: { message?: string } };
    try {
      parsed = JSON.parse(up.body);
    } catch {
      throw new Error(`RPC answered ${up.status} without JSON`);
    }
    if (typeof parsed.result === "string") return parsed.result;
    throw new Error(parsed.error?.message ?? `RPC answered ${up.status}`);
  };
}

let cached: { cluster: RuntimeCluster; relayer: Keypair } | undefined;

/** Cluster + relayer key, loaded once per process. Throws when the key is absent (the route answers 503). */
export function relayRuntime(): { cluster: RuntimeCluster; relayer: Keypair } {
  if (cached) return cached;
  const cluster = runtimeCluster();
  cached = { cluster, relayer: loadKeypair(cluster.keysDir, webConfig.relay.keyRole) };
  return cached;
}
