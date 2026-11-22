// Values come from config/app.json (repo root) and env; nothing here is a hard-coded setting.
import app from "../../../../config/app.json";
import idl from "@kekal/sdk/idl";

export type WebConfig = typeof app.web;
export type ClusterName = keyof typeof app.clusters;

export const webConfig: WebConfig = app.web;

export interface RuntimeCluster {
  name: string;
  rpcUrls: string[];
  programId: string;
  explorerTx: string;
  tokenDecimals: number;
  /** Mints the relayer lets through: KEKAL_MINTS (comma list) or the non-null cluster mints. */
  mints: string[];
  /** Server key folder: KEKAL_KEYS_DIR or the cluster keysDir ("~" = home). Null = no keys on this cluster. */
  keysDir: string | null;
}

/** Comma- or space-separated list; empty entries dropped. */
export function parseUrlList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function runtimeCluster(env: Record<string, string | undefined> = process.env): RuntimeCluster {
  const name = env.KEKAL_CLUSTER ?? app.defaultCluster;
  const c = (app.clusters as Record<string, (typeof app.clusters)[ClusterName]>)[name];
  if (!c) throw new Error(`unknown cluster "${name}" (config/app.json has: ${Object.keys(app.clusters).join(", ")})`);
  const fromEnv = parseUrlList(env.RPC_URLS);
  const rpcUrls = fromEnv.length > 0 ? fromEnv : c.rpcUrls;
  if (rpcUrls.length === 0) throw new Error(`cluster ${name}: no RPC URLs (config rpcUrls and RPC_URLS are empty)`);
  return {
    name,
    rpcUrls,
    programId: env.KEKAL_PROGRAM_ID ?? c.programId ?? idl.address,
    explorerTx: c.explorerTx,
    tokenDecimals: c.tokenDecimals,
    mints: (() => {
      const listed = parseUrlList(env.KEKAL_MINTS);
      return listed.length > 0 ? listed : (Object.values(c.mints) as (string | null)[]).filter((m): m is string => typeof m === "string");
    })(),
    keysDir: env.KEKAL_KEYS_DIR ?? c.keysDir,
  };
}

/** Reserve of the sample card on the home page: the lifecycle reserve of the default cluster, in token units. */
export function sampleReserve(): string {
  const c = app.clusters[app.defaultCluster as ClusterName];
  const units = Number(BigInt(c.lifecycle.reserve)) / 10 ** c.tokenDecimals;
  return units.toFixed(2);
}
