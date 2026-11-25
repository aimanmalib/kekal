// Whether the relayer can still pay fees, for /api/health. Pure and cached so a busy health check costs one RPC read per window.
export interface FundedDeps {
  /** Relayer address, or null when its key is not loaded. */
  address: () => string | null;
  /** Balance in lamports; throws when no RPC endpoint answered. */
  getBalance: (address: string) => Promise<number>;
  minLamports: number;
  cacheMs: number;
  now?: () => number;
}

export function relayerFundedCheck(deps: FundedDeps): () => Promise<boolean | null> {
  const now = deps.now ?? Date.now;
  let cached: { at: number; value: boolean | null } | undefined;
  return async () => {
    const t = now();
    if (cached && t - cached.at < deps.cacheMs) return cached.value;
    const address = deps.address();
    let value: boolean | null = null;
    if (address !== null) {
      try {
        value = (await deps.getBalance(address)) >= deps.minLamports;
      } catch (e) {
        console.error("health: relayer balance", (e as Error).message);
      }
    }
    cached = { at: t, value };
    return value;
  };
}
