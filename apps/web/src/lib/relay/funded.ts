// Devnet SOL left on the keys that pay for the public demo, for /api/health. Pure and cached so a busy health check
// costs one RPC read per key per window.
export const FUND_ROLES = ["demoSeller", "relayer"] as const;
export type FundRole = (typeof FUND_ROLES)[number];
type PerRole<T> = Record<FundRole, T>;

export interface Funds {
  /** Relayer balance at or above relayerMinLamports; null when its key is not loaded or the RPC did not answer. */
  relayerFunded: boolean | null;
  /** Whole demo runs each key can still pay for (balance / runCostLamports); null when unknown. */
  runsLeft: PerRole<number | null>;
  balancesSol: PerRole<number | null>;
}

export interface FundsDeps {
  /** Address per role, or null when that key is not loaded. */
  addresses: () => PerRole<string | null>;
  /** Balance in lamports; throws when no RPC endpoint answered. */
  getBalance: (address: string) => Promise<number>;
  /** What one demo run costs each key, measured on devnet (docs/MEASURED.md). */
  runCostLamports: PerRole<number>;
  relayerMinLamports: number;
  cacheMs: number;
  now?: () => number;
}

export const NO_FUNDS: Funds = {
  relayerFunded: null,
  runsLeft: { demoSeller: null, relayer: null },
  balancesSol: { demoSeller: null, relayer: null },
};

async function readBalance(deps: FundsDeps, role: FundRole, address: string | null): Promise<number | null> {
  if (address === null) return null;
  try {
    return await deps.getBalance(address);
  } catch (e) {
    console.error(`health: ${role} balance`, (e as Error).message);
    return null;
  }
}

export function fundsCheck(deps: FundsDeps): () => Promise<Funds> {
  const now = deps.now ?? Date.now;
  let cached: { at: number; value: Funds } | undefined;
  return async () => {
    const t = now();
    if (cached && t - cached.at < deps.cacheMs) return cached.value;
    const addresses = deps.addresses();
    const lamports = await Promise.all(FUND_ROLES.map((r) => readBalance(deps, r, addresses[r])));
    const value: Funds = { relayerFunded: null, runsLeft: { ...NO_FUNDS.runsLeft }, balancesSol: { ...NO_FUNDS.balancesSol } };
    FUND_ROLES.forEach((role, i) => {
      const l = lamports[i];
      if (l === null || l === undefined) return;
      value.runsLeft[role] = Math.floor(l / deps.runCostLamports[role]);
      value.balancesSol[role] = Math.round(l / 1e3) / 1e6;
    });
    const relayer = lamports[FUND_ROLES.indexOf("relayer")];
    value.relayerFunded = relayer === null || relayer === undefined ? null : relayer >= deps.relayerMinLamports;
    cached = { at: t, value };
    return value;
  };
}
