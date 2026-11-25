// Seller and arbiter sign-in (PRD 4.3): server nonce -> wallet signs the message -> httpOnly cookie.
// The cookie is `<pubkey>.<expires>.<hmac>`; it proves which key signed in, not what that key may do.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { DataStore } from "@kekal/server";
import { verifyEd25519 } from "./ed25519";
import { translator, type Lang } from "./i18n";
import { siteUrl } from "./site";

export interface SessionPolicy {
  ttlSecs: number;
  nonceTtlSecs: number;
  minSecretLength: number;
}

export type SessionError = "bad_request" | "bad_pubkey" | "nonce_unknown" | "pubkey_mismatch" | "bad_signature";

function parsePubkey(v: unknown): PublicKey | null {
  if (typeof v !== "string") return null;
  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
}

/** The secret from env, or null when it is missing or too short (session endpoints then answer 503). */
export function sessionSecret(env: Record<string, string | undefined>, policy: SessionPolicy): string | null {
  const s = env.KEKAL_SESSION_SECRET ?? "";
  return s.length >= policy.minSecretLength ? s : null;
}

/**
 * The domain the sign-in message names: the site's own public host (KEKAL_SITE_URL or config web.site.url), never the
 * request's Host header. Otherwise a look-alike site could fetch a nonce under its own name, show the victim a message
 * naming that name, and replay the signature here.
 */
export function signInDomain(env: Record<string, string | undefined> = process.env): string {
  return siteUrl(env).host;
}

export function signInMessage(lang: Lang, f: { domain: string; pubkey: string; nonce: string; issuedAt: number; expiresAt: number }): string {
  const iso = (t: number) => new Date(t * 1000).toISOString();
  return translator(lang)("session.signMessage")
    .replaceAll("{domain}", f.domain)
    .replaceAll("{pubkey}", f.pubkey)
    .replaceAll("{nonce}", f.nonce)
    .replaceAll("{issued}", iso(f.issuedAt))
    .replaceAll("{expires}", iso(f.expiresAt));
}

export function issueNonce(
  store: DataStore,
  input: { pubkey: unknown; domain: string; lang: Lang; now: number },
  policy: SessionPolicy,
): { ok: true; nonce: string; message: string; expiresAt: number } | { ok: false; error: SessionError } {
  const pk = parsePubkey(input.pubkey);
  if (!pk) return { ok: false, error: "bad_pubkey" };
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = input.now + policy.nonceTtlSecs;
  const pubkey = pk.toBase58();
  const message = signInMessage(input.lang, { domain: input.domain, pubkey, nonce, issuedAt: input.now, expiresAt });
  store.putNonce({ nonce, pubkey, message, expiresAt }, input.now);
  return { ok: true, nonce, message, expiresAt };
}

function mac(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function sessionToken(secret: string, pubkey: string, expiresAt: number): string {
  const payload = `${pubkey}.${expiresAt}`;
  return `${payload}.${mac(secret, payload).toString("base64url")}`;
}

/** The signed-in public key, or null when the token is absent, forged or expired. */
export function readSession(token: string | undefined, secret: string, now: number): string | null {
  const parts = (token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [pubkey = "", exp = "", sig = ""] = parts;
  const want = mac(secret, `${pubkey}.${exp}`);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
  return parsePubkey(pubkey) ? pubkey : null;
}

/** Checks the signed challenge (signature = base64 of the 64-byte Ed25519 signature over the UTF-8 message). */
export function completeSignIn(
  store: DataStore,
  input: { pubkey?: unknown; nonce?: unknown; signature?: unknown; now: number },
  policy: SessionPolicy,
  secret: string,
): { ok: true; pubkey: string; token: string; expiresAt: number } | { ok: false; error: SessionError } {
  const { nonce, signature } = input;
  if (typeof nonce !== "string" || typeof signature !== "string") return { ok: false, error: "bad_request" };
  const pk = parsePubkey(input.pubkey);
  if (!pk) return { ok: false, error: "bad_pubkey" };
  // Taking the nonce burns it, so a wrong signature cannot be retried against the same challenge.
  const row = store.takeNonce(nonce, input.now);
  if (!row) return { ok: false, error: "nonce_unknown" };
  if (row.pubkey !== pk.toBase58()) return { ok: false, error: "pubkey_mismatch" };
  const sig = Buffer.from(signature, "base64");
  if (!verifyEd25519(pk.toBytes(), new TextEncoder().encode(row.message), sig)) return { ok: false, error: "bad_signature" };
  const expiresAt = input.now + policy.ttlSecs;
  return { ok: true, pubkey: row.pubkey, token: sessionToken(secret, row.pubkey, expiresAt), expiresAt };
}
