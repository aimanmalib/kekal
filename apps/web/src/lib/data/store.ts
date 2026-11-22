// One interface in front of the off-chain store (PRD 4.9). S0 = SQLite; Supabase arrives behind the same interface.

export interface DataStore {
  readonly backend: string;
  getConfig(key: string): string | null;
  setConfig(key: string, value: string, now: number): void;
  /** Adds one hit to a fixed window and returns the window's count after the hit. */
  hit(key: string, windowSecs: number, now: number): number;
  close(): void;
}

export type BackendName = "sqlite" | "supabase";

export function backendName(env: Record<string, string | undefined>, fallback: string): BackendName {
  const v = (env.DATA_BACKEND ?? fallback).trim().toLowerCase();
  if (v === "sqlite" || v === "supabase") return v;
  throw new Error(`DATA_BACKEND must be sqlite or supabase (got "${v}")`);
}
