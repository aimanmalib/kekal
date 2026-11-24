// Cluster values for server processes (web routes, keeper): config/app.json with env overrides. Nothing is hard-coded here.
import app from "../../../config/app.json" with { type: "json" };
import idl from "@kekal/sdk/idl";

export type AppConfig = typeof app;
export type ClusterName = keyof typeof app.clusters;
export type ClusterSettings = (typeof app.clusters)[ClusterName];
export type DemoSettings = ClusterSettings["demo"];

export const appConfig: AppConfig = app;

export interface RuntimeCluster {
  name: string;
  rpcUrls: string[];
  programId: string;
  /** False until the program is on this cluster: KEKAL_PROGRAM_DEPLOYED ("true"/"false") or the cluster `deployed`. */
  deployed: boolean;
  explorerTx: string;
  tokenDecimals: number;
  /** Mints the relayer lets through: KEKAL_MINTS (comma list) or the non-null cluster mints. */
  mints: string[];
  /** Server key folder: KEKAL_KEYS_DIR or the cluster keysDir ("~" = home). Null = no keys on this cluster. */
  keysDir: string | null;
  demo: DemoSettings;
}

/** Comma- or space-separated list; empty entries dropped. */
export function parseUrlList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** "true"/"1" or "false"/"0" (any case); unset = the fallback; anything else is an error, not a silent default. */
export function parseFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  throw new Error(`expected true or false, got "${raw}"`);
}

export function clusterSettings(name: string): ClusterSettings {
  const c = (app.clusters as Record<string, ClusterSettings>)[name];
  if (!c) throw new Error(`unknown cluster "${name}" (config/app.json has: ${Object.keys(app.clusters).join(", ")})`);
  return c;
}

export function runtimeCluster(env: Record<string, string | undefined> = process.env): RuntimeCluster {
  const name = env.KEKAL_CLUSTER ?? app.defaultCluster;
  const c = clusterSettings(name);
  const fromEnv = parseUrlList(env.RPC_URLS);
  const rpcUrls = fromEnv.length > 0 ? fromEnv : c.rpcUrls;
  if (rpcUrls.length === 0) throw new Error(`cluster ${name}: no RPC URLs (config rpcUrls and RPC_URLS are empty)`);
  const listed = parseUrlList(env.KEKAL_MINTS);
  const configured = (Object.values(c.mints) as (string | null)[]).filter((m): m is string => typeof m === "string");
  return {
    name,
    rpcUrls,
    programId: env.KEKAL_PROGRAM_ID ?? c.programId ?? idl.address,
    deployed: parseFlag(env.KEKAL_PROGRAM_DEPLOYED, c.deployed),
    explorerTx: c.explorerTx,
    tokenDecimals: c.tokenDecimals,
    mints: listed.length > 0 ? listed : configured,
    keysDir: env.KEKAL_KEYS_DIR ?? c.keysDir,
    demo: c.demo,
  };
}

export function explorerTxUrl(cluster: Pick<RuntimeCluster, "explorerTx">, sig: string): string {
  return cluster.explorerTx.replace("{sig}", sig);
}
