import type { RuntimeCluster } from "./config";

export interface Health {
  ok: boolean;
  cluster: string;
  programId: string;
  dataBackend: string | null;
  keeperLastRun: number | null;
  /** Optional integrations that are live in this deployment. */
  features: string[];
  /** null until the relayer is configured. */
  relayerFunded: boolean | null;
  error?: string;
}

export const KEEPER_LAST_RUN_KEY = "keeper_last_run";

export function buildHealth(
  cluster: RuntimeCluster,
  store: { backend: string; getConfig(key: string): string | null } | Error,
): Health {
  const base = { cluster: cluster.name, programId: cluster.programId, features: [], relayerFunded: null };
  if (store instanceof Error) {
    return { ok: false, ...base, dataBackend: null, keeperLastRun: null, error: "data store unavailable" };
  }
  const raw = store.getConfig(KEEPER_LAST_RUN_KEY);
  const n = raw === null ? NaN : Number(raw);
  return { ok: true, ...base, dataBackend: store.backend, keeperLastRun: Number.isFinite(n) ? n : null };
}
