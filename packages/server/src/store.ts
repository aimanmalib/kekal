// One interface in front of the off-chain store (PRD 4.9): SQLite (sqlite.ts) or Supabase Postgres (postgres.ts).
// Every call is async so a networked database fits behind it; callers await each result.

export interface DataStore {
  readonly backend: string;
  getConfig(key: string): Promise<string | null>;
  setConfig(key: string, value: string, now: number): Promise<void>;
  /** Adds one hit to a fixed window and returns the window's count after the hit. */
  hit(key: string, windowSecs: number, now: number): Promise<number>;
  /** Stores a sign-in challenge and drops challenges that expired before `now`. */
  putNonce(n: SessionNonce, now: number): Promise<void>;
  /** Marks the challenge used and returns it, once, if it exists and has not expired; otherwise null. */
  takeNonce(nonce: string, now: number): Promise<SessionNonce | null>;
  /** Records a warranty a demo route issued. Replays of the same warranty are ignored. */
  putDemoSession(s: DemoSession): Promise<void>;
  getDemoSession(warranty: string): Promise<DemoSession | null>;
  /** Keeps the terms text whose hash a warranty carries. The first write wins: terms never change after issue. */
  putWarrantyTerms(pda: string, termsJson: string, now: number): Promise<void>;
  getWarrantyTerms(pda: string): Promise<string | null>;
  close(): Promise<void>;
}

/** A warranty issued by /api/demo/session ("shared") or /api/demo/dying-shop ("dying"). No visitor data is kept. */
export interface DemoSession {
  warranty: string;
  holder: string;
  shop: string;
  kind: "shared" | "dying";
  createdAt: number;
}

export interface SessionNonce {
  nonce: string;
  pubkey: string;
  message: string;
  expiresAt: number;
}

export type BackendName = "sqlite" | "supabase";

/** Start of the fixed window that holds `now` (both adapters count hits per window start). */
export function windowStart(now: number, windowSecs: number): number {
  return now - (now % windowSecs);
}

export function backendName(env: Record<string, string | undefined>, fallback: string): BackendName {
  const v = (env.DATA_BACKEND ?? fallback).trim().toLowerCase();
  if (v === "sqlite" || v === "supabase") return v;
  throw new Error(`DATA_BACKEND must be sqlite or supabase (got "${v}")`);
}
