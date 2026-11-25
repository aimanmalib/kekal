import type { PublicKey } from "@solana/web3.js";

/** The parts of the on-chain `Config` that a deploy must check. */
export interface ConfigView {
  admin: PublicKey;
  allowedMints: PublicKey[];
}

/**
 * What is wrong with `Config` right after a deploy. Empty means it exists, the deployer key is its admin and every
 * configured mint is allowed. Anyone may call `init_config` first, so the deploy script stops when this is not empty.
 */
export function configProblems(cfg: ConfigView | null, admin: PublicKey, mints: PublicKey[]): string[] {
  if (!cfg) return ["Config account is missing"];
  const out: string[] = [];
  if (!cfg.admin.equals(admin)) out.push(`Config.admin is ${cfg.admin.toBase58()}, not the deployer ${admin.toBase58()}`);
  for (const m of mints) {
    if (!cfg.allowedMints.some((a) => a.equals(m))) out.push(`mint ${m.toBase58()} is not in Config.allowedMints`);
  }
  return out;
}

export interface StepCu {
  step: string;
  transactions: number;
  min: number;
  max: number;
}

/**
 * Compute units per lifecycle step (one step = one transaction). Steps keep their first-seen order; a step whose
 * units are unknown (transaction not found) is left out rather than counted as zero.
 */
export function cuByStep(rows: { step: string; units: number | null }[]): StepCu[] {
  const out = new Map<string, StepCu>();
  for (const { step, units } of rows) {
    if (units === null) continue;
    const s = out.get(step);
    if (!s) out.set(step, { step, transactions: 1, min: units, max: units });
    else {
      s.transactions++;
      s.min = Math.min(s.min, units);
      s.max = Math.max(s.max, units);
    }
  }
  return [...out.values()];
}
