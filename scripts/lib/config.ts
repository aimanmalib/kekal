import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConfigLimits, ShopWindows } from "@kekal/sdk";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface LifecycleSettings {
  airdropSol: number;
  mintAmount: string;
  depositAmount: string;
  reserve: string;
  termSecs: number;
  shortTermSecs: number;
  shopWindows: ShopWindows;
  dyingShopWindows: ShopWindows;
  dyingShopSol: number;
  timeoutSecs: number;
}

export interface DemoShopConfig {
  role: string;
  windows: ShopWindows;
  depositAmount: string;
}

export interface DemoSettings {
  reserve: string;
  termSecs: number;
  sharedShop: DemoShopConfig & { sellerFloat: string };
  dyingShop: { windows: ShopWindows; sol: number };
  showcaseShop: DemoShopConfig & { warranties: number; sol: number };
}

export interface ClusterConfig {
  name: string;
  rpcUrls: string[];
  /** Pacing for public endpoints that rate-limit by IP; absent = plain fetch (local validator). */
  scriptRpc?: { minGapMs: number; retryMs: number; maxRetries: number };
  explorerTx: string;
  programId: string | null;
  keysDir: string | null;
  mints: { kusd: string | null; usdc: string | null };
  tokenDecimals: number;
  limits: ConfigLimits;
  lifecycle: LifecycleSettings;
  demo: DemoSettings;
}

interface AppConfig {
  defaultCluster: string;
  web: { demo: { dyingShopsPerDay: number } };
  clusters: Record<string, Omit<ClusterConfig, "name">>;
}

export function loadAppConfig(path = join(REPO_ROOT, "config/app.json")): AppConfig {
  return JSON.parse(readFileSync(path, "utf8")) as AppConfig;
}

export function clusterConfig(name?: string, app = loadAppConfig()): ClusterConfig {
  const key = name ?? app.defaultCluster;
  const c = app.clusters[key];
  if (!c) throw new Error(`unknown cluster "${key}" (config/app.json has: ${Object.keys(app.clusters).join(", ")})`);
  if (c.rpcUrls.length === 0) throw new Error(`cluster ${key}: rpcUrls is empty`);
  return { name: key, ...c };
}

export function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

export function explorerUrl(c: ClusterConfig, sig: string): string {
  return c.explorerTx.replace("{sig}", sig);
}

/** `--name value` style flags. */
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = "true";
    else {
      out[a.slice(2)] = next;
      i++;
    }
  }
  return out;
}
