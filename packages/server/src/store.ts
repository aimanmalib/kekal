// One interface in front of the off-chain store (PRD 4.9). S0 = SQLite; Supabase arrives behind the same interface.

export interface DataStore {
  readonly backend: string;
  getConfig(key: string): string | null;
  setConfig(key: string, value: string, now: number): void;
  /** Adds one hit to a fixed window and returns the window's count after the hit. */
  hit(key: string, windowSecs: number, now: number): number;
  /** Stores a sign-in challenge and drops challenges that expired before `now`. */
  putNonce(n: SessionNonce, now: number): void;
  /** Marks the challenge used and returns it, once, if it exists and has not expired; otherwise null. */
  takeNonce(nonce: string, now: number): SessionNonce | null;
  /** Records a warranty a demo route issued. Replays of the same warranty are ignored. */
  putDemoSession(s: DemoSession): void;
  getDemoSession(warranty: string): DemoSession | null;
  /** Keeps the terms text whose hash a warranty carries. The first write wins: terms never change after issue. */
  putWarrantyTerms(pda: string, termsJson: string, now: number): void;
  getWarrantyTerms(pda: string): string | null;
  close(): void;
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

export function backendName(env: Record<string, string | undefined>, fallback: string): BackendName {
  const v = (env.DATA_BACKEND ?? fallback).trim().toLowerCase();
  if (v === "sqlite" || v === "supabase") return v;
  throw new Error(`DATA_BACKEND must be sqlite or supabase (got "${v}")`);
}
