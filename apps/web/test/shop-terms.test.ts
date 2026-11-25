// /kedai terms: the text whose SHA-256 the card carries, kept by the server only when it matches the chain.
import { Keypair } from "@solana/web3.js";
import { toHex } from "@kekal/sdk";
import { describe, expect, it } from "vitest";
import { acceptTerms } from "../src/lib/shop/accept-terms";
import { shopProductHash, shopTermsJson, termsHashOf } from "../src/lib/shop/terms";
import { readTerms } from "../src/lib/warranty/terms";
import { termsMatch } from "../src/lib/warranty/read";

const input = { product: " Water heater ", serial: "SN-1", promise: { en: "We fix our installation.", ms: "Kami baiki pemasangan kami." }, reserve: "25000000", termSecs: 3600 };
const pda = Keypair.generate().publicKey.toBase58();

function deps(onChain: Uint8Array | null | Error, perIp = 10) {
  const kept = new Map<string, string>();
  const hits = new Map<string, number>();
  return {
    kept,
    deps: {
      store: { hit: async (k: string) => hits.set(k, (hits.get(k) ?? 0) + 1).get(k)!, putWarrantyTerms: async (p: string, j: string) => void (kept.has(p) || kept.set(p, j)) },
      maxBytes: 4096,
      perIpPerHour: perIp,
      chainTermsHash: async () => {
        if (onChain instanceof Error) throw onChain;
        return onChain;
      },
      now: 0,
    },
  };
}

describe("shop terms", () => {
  it("is canonical, trimmed, and readable by the warranty page in both languages", () => {
    const json = shopTermsJson(input);
    expect(json).toBe(shopTermsJson({ ...input, product: "Water heater" }));
    expect(termsMatch(json, termsHashOf(json))).toBe(true);
    expect(readTerms(json, "ms", "en")).toEqual({ product: "Water heater", promise: "Kami baiki pemasangan kami." });
    expect(readTerms(json, "en", "en").promise).toBe("We fix our installation.");
  });

  it("binds the product hash to the shop", () => {
    const a = shopProductHash(Keypair.generate().publicKey, input);
    const b = shopProductHash(Keypair.generate().publicKey, input);
    expect(toHex(a)).not.toBe(toHex(b));
  });
});

describe("acceptTerms", () => {
  const json = shopTermsJson(input);

  it("keeps text that hashes to the on-chain terms_hash", async () => {
    const d = deps(termsHashOf(json));
    expect(await acceptTerms({ warranty: pda, terms: json }, "ip", d.deps)).toEqual({ ok: true });
    expect(d.kept.get(pda)).toBe(json);
  });

  it("refuses text that does not match, a missing warranty and network trouble", async () => {
    expect(await acceptTerms({ warranty: pda, terms: `${json} ` }, "ip", deps(termsHashOf(json)).deps)).toMatchObject({ status: 400, error: "hash_mismatch" });
    expect(await acceptTerms({ warranty: pda, terms: json }, "ip", deps(null).deps)).toMatchObject({ status: 404, error: "not_found" });
    expect(await acceptTerms({ warranty: pda, terms: json }, "ip", deps(new Error("down")).deps)).toMatchObject({ status: 502, error: "network" });
  });

  it("refuses bad input, oversized text and callers over the hourly limit", async () => {
    const d = deps(termsHashOf(json), 1);
    expect(await acceptTerms({ warranty: "nope", terms: json }, "ip", d.deps)).toMatchObject({ status: 400, error: "bad_request" });
    expect(await acceptTerms({ warranty: pda, terms: "x".repeat(5000) }, "ip", d.deps)).toMatchObject({ status: 413, error: "too_large" });
    expect(await acceptTerms({ warranty: pda, terms: json }, "ip", d.deps)).toEqual({ ok: true });
    expect(await acceptTerms({ warranty: pda, terms: json }, "ip", d.deps)).toMatchObject({ status: 429, error: "rate_ip" });
  });
});
