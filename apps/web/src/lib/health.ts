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
  /** Relayer balance at or above web.health.relayerMinSol; null when its key is not loaded or the RPC did not answer. */
  relayerFunded: boolean | null;
  error?: string;
}

export const KEEPER_LAST_RUN_KEY = "keeper_last_run";

/** Optional integrations live in this process. Only those whose code runs here are listed. */
export function liveFeatures(dataBackend: string): string[] {
  return dataBackend === "supabase" ? ["supabase"] : [];
}

export async function buildHealth(
  cluster: RuntimeCluster,
  store: { backend: string; getConfig(key: string): Promise<string | null> } | Error,
  relayerFunded: () => Promise<boolean | null> = async () => null,
): Promise<Health> {
  const base = {
    cluster: cluster.name,
    programId: cluster.programId,
    program: cluster.deployed ? ("deployed" as const) : ("not_deployed" as const),
    features: store instanceof Error ? [] : liveFeatures(store.backend),
    relayerFunded: await relayerFunded(),
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
