import type { RuntimeCluster } from "./config";

export interface Health {
  ok: boolean;
  cluster: string;
  programId: string;
  /** "not_deployed" while the program is not on this cluster (config `deployed: false`). */
  program: "deployed" | "not_deployed";
  dataBackend: string | null;
  keeperLastRun: number | null;
  /** Optional integrations that are live in this deployment. */
  features: string[];
  /** null until the relayer is configured. */
  relayerFunded: boolean | null;
  error?: string;
}

export const KEEPER_LAST_RUN_KEY = "keeper_last_run";

export async function buildHealth(
  cluster: RuntimeCluster,
  store: { backend: string; getConfig(key: string): Promise<string | null> } | Error,
): Promise<Health> {
  const base = {
    cluster: cluster.name,
    programId: cluster.programId,
    program: cluster.deployed ? ("deployed" as const) : ("not_deployed" as const),
    features: [],
    relayerFunded: null,
  };
  const down = { ok: false, ...base, dataBackend: null, keeperLastRun: null, error: "data store unavailable" };
  if (store instanceof Error) return down;
  let raw: string | null;
  try {
    raw = await store.getConfig(KEEPER_LAST_RUN_KEY);
  } catch (e) {
    console.error("health: data store", (e as Error).message);
    return down;
  }
  const n = raw === null ? NaN : Number(raw);
  return { ok: true, ...base, dataBackend: store.backend, keeperLastRun: Number.isFinite(n) ? n : null };
}
