import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import { openSqlite } from "@kekal/server";
import type { DataStore } from "@kekal/server";
import { completeSignIn, issueNonce, readSession, sessionSecret, sessionToken } from "../src/lib/session";
import { signBytes } from "./relay-fixtures";

const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");
const policy = { ttlSecs: 3600, nonceTtlSecs: 300, minSecretLength: 32 };
const secret = "s".repeat(32);
const now = 1_800_000_000;
const stores: DataStore[] = [];
afterEach(async () => {
  while (stores.length) await stores.pop()!.close();
});
function store() {
  const s = openSqlite(":memory:", MIGRATIONS);
  stores.push(s);
  return s;
}
const seller = Keypair.generate();
const sig64 = (kp: Keypair, msg: string) => Buffer.from(signBytes(kp, new TextEncoder().encode(msg))).toString("base64");

async function challenge(s: DataStore, lang: "en" | "ms" = "en") {
  const r = await issueNonce(s, { pubkey: seller.publicKey.toBase58(), domain: "kekal.test", lang, now }, policy);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("seller session", () => {
  it("message names the domain, wallet and nonce in both languages", async () => {
    const s = store();
    for (const lang of ["en", "ms"] as const) {
      const c = await challenge(s, lang);
      for (const part of ["kekal.test", seller.publicKey.toBase58(), c.nonce]) expect(c.message).toContain(part);
      expect(c.message).not.toMatch(/\{\w+\}/);
    }
  });
  it("signed challenge -> token that reads back as the wallet", async () => {
    const s = store();
    const c = await challenge(s);
    const r = await completeSignIn(s, { pubkey: seller.publicKey.toBase58(), nonce: c.nonce, signature: sig64(seller, c.message), now: now + 5 }, policy, secret);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expiresAt).toBe(now + 5 + policy.ttlSecs);
    expect(readSession(r.token, secret, now + 10)).toBe(seller.publicKey.toBase58());
  });
  it("a nonce works once, even after a wrong signature", async () => {
    const s = store();
    const c = await challenge(s);
    const input = { pubkey: seller.publicKey.toBase58(), nonce: c.nonce, now };
    expect(await completeSignIn(s, { ...input, signature: sig64(Keypair.generate(), c.message) }, policy, secret)).toEqual({ ok: false, error: "bad_signature" });
    expect(await completeSignIn(s, { ...input, signature: sig64(seller, c.message) }, policy, secret)).toEqual({ ok: false, error: "nonce_unknown" });
  });
  it("signature over a different message is refused", async () => {
    const s = store();
    const c = await challenge(s);
    const r = await completeSignIn(s, { pubkey: seller.publicKey.toBase58(), nonce: c.nonce, signature: sig64(seller, c.message + " "), now }, policy, secret);
    expect(r).toEqual({ ok: false, error: "bad_signature" });
  });
  it("nonce for another wallet, unknown or expired nonce", async () => {
    const s = store();
    const other = Keypair.generate();
    const c = await challenge(s);
    expect(await completeSignIn(s, { pubkey: other.publicKey.toBase58(), nonce: c.nonce, signature: sig64(other, c.message), now }, policy, secret))
      .toEqual({ ok: false, error: "pubkey_mismatch" });
    const late = await challenge(s);
    expect(await completeSignIn(s, { pubkey: seller.publicKey.toBase58(), nonce: late.nonce, signature: sig64(seller, late.message), now: now + 301 }, policy, secret))
      .toEqual({ ok: false, error: "nonce_unknown" });
    expect(await completeSignIn(s, { pubkey: seller.publicKey.toBase58(), nonce: "00", signature: "AA==", now }, policy, secret))
      .toEqual({ ok: false, error: "nonce_unknown" });
  });
  it("bad input", async () => {
    const s = store();
    expect(await issueNonce(s, { pubkey: "nope", domain: "d", lang: "en", now }, policy)).toEqual({ ok: false, error: "bad_pubkey" });
    expect(await completeSignIn(s, { pubkey: seller.publicKey.toBase58(), nonce: 1, signature: "x", now }, policy, secret))
      .toEqual({ ok: false, error: "bad_request" });
  });
  it("forged, altered or expired tokens read as signed out", async () => {
    const pk = seller.publicKey.toBase58();
    const t = sessionToken(secret, pk, now + 100);
    expect(readSession(t, secret, now)).toBe(pk);
    expect(readSession(t, "t".repeat(32), now)).toBeNull();
    expect(readSession(t, secret, now + 101)).toBeNull();
    const other = Keypair.generate().publicKey.toBase58();
    expect(readSession(t.replace(pk, other), secret, now)).toBeNull();
    expect(readSession(t.replace(`.${now + 100}.`, `.${now + 9999}.`), secret, now)).toBeNull();
    expect(readSession(undefined, secret, now)).toBeNull();
    expect(readSession("a.b", secret, now)).toBeNull();
  });
  it("secret must be long enough", async () => {
    expect(sessionSecret({ KEKAL_SESSION_SECRET: "short" }, policy)).toBeNull();
    expect(sessionSecret({}, policy)).toBeNull();
    expect(sessionSecret({ KEKAL_SESSION_SECRET: secret }, policy)).toBe(secret);
  });
});
