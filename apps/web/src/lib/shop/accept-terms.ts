// POST /api/terms: keeps a seller's terms text when it hashes to the warranty's on-chain terms_hash. The hash is the
// proof, so no sign-in is needed; the store keeps the first write.
import type { DataStore } from "@kekal/server";
import { toHex } from "@kekal/sdk";
import { parseAddress } from "../warranty/read";
import { termsHashOf } from "./terms";

export type TermsError = "bad_request" | "too_large" | "rate_ip" | "not_found" | "hash_mismatch" | "network";
export type TermsResult = { ok: true } | { ok: false; status: number; error: TermsError };

export interface TermsDeps {
  store: Pick<DataStore, "hit" | "putWarrantyTerms">;
  maxBytes: number;
  perIpPerHour: number;
  /** The warranty's on-chain terms_hash, null when no Kekal warranty lives there. Network trouble throws. */
  chainTermsHash: (warranty: string) => Promise<Uint8Array | null>;
  now: number;
}

export async function acceptTerms(body: unknown, ip: string, deps: TermsDeps): Promise<TermsResult> {
  const b = (body ?? {}) as { warranty?: unknown; terms?: unknown };
  if (typeof b.warranty !== "string" || typeof b.terms !== "string") return { ok: false, status: 400, error: "bad_request" };
  const pda = parseAddress(b.warranty);
  if (!pda) return { ok: false, status: 400, error: "bad_request" };
  if (new TextEncoder().encode(b.terms).length > deps.maxBytes) return { ok: false, status: 413, error: "too_large" };
  if (deps.store.hit(`terms:ip:${ip}`, 3600, deps.now) > deps.perIpPerHour) return { ok: false, status: 429, error: "rate_ip" };
  let onChain: Uint8Array | null;
  try {
    onChain = await deps.chainTermsHash(pda.toBase58());
  } catch {
    return { ok: false, status: 502, error: "network" };
  }
  if (!onChain) return { ok: false, status: 404, error: "not_found" };
  if (toHex(termsHashOf(b.terms)) !== toHex(onChain)) return { ok: false, status: 400, error: "hash_mismatch" };
  deps.store.putWarrantyTerms(pda.toBase58(), b.terms, deps.now);
  return { ok: true };
}
