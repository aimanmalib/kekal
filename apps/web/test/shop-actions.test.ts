// Instructions behind /kedai and /timbang, built offline: accounts, hashes and who pays.
import { IDL_PROGRAM_ID, shopPda, toHex, warrantyPda } from "@kekal/sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { depositIxs, issueIxs, resolveIxs, responseHash, withdrawIxs } from "../src/lib/shop/actions";
import { shopTermsJson, termsHashOf } from "../src/lib/shop/terms";
import { mint, program } from "./relay-fixtures";

const owner = Keypair.generate().publicKey;
const has = (keys: { pubkey: PublicKey }[], k: PublicKey) => keys.some((m) => m.pubkey.equals(k));

describe("shop actions", () => {
  it("issues to the card key with the terms hash of the exact text, after a heartbeat", async () => {
    const holder = Keypair.generate().publicKey;
    const input = { product: "Fan", serial: "S1", promise: { en: "e", ms: "m" }, reserve: "1000", termSecs: 600, holder, warrantyId: 4n };
    const { ixs, termsJson } = await issueIxs(program, owner, input);
    expect(termsJson).toBe(shopTermsJson(input));
    expect(ixs).toHaveLength(2);
    const issue = ixs[1]!;
    const shop = shopPda(IDL_PROGRAM_ID, owner);
    expect(has(issue.keys, warrantyPda(IDL_PROGRAM_ID, shop, 4n))).toBe(true);
    expect(Buffer.from(issue.data).toString("hex")).toContain(holder.toBuffer().toString("hex"));
    expect(Buffer.from(issue.data).toString("hex")).toContain(toHex(termsHashOf(termsJson)));
  });

  it("moves funds through the owner's associated token account, creating it before a withdraw", async () => {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    const [dep] = await depositIxs(program, owner, mint.toBase58(), 5n);
    expect(has(dep!.keys, ata)).toBe(true);
    const w = await withdrawIxs(program, owner, mint.toBase58(), 5n);
    expect(w[0]!.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(has(w[1]!.keys, ata)).toBe(true);
  });

  it("fingerprints the answer, so accept and reject with the same note differ", () => {
    expect(toHex(responseHash(true, "ok"))).not.toBe(toHex(responseHash(false, "ok")));
    expect(toHex(responseHash(false, " note "))).toBe(toHex(responseHash(false, "note")));
  });

  it("has the arbiter pay for its own ruling", async () => {
    const arbiter = Keypair.generate().publicKey;
    const k = () => Keypair.generate().publicKey.toBase58();
    const d = { claim: k(), index: 0, warranty: k(), warrantyId: "0", shop: k(), shopOwner: k(), holder: k(), mint: mint.toBase58(), reserve: "1", escalatedAt: 0, staleAt: 0 };
    const [r] = await resolveIxs(program, arbiter, d, true);
    expect(r!.keys.filter((m) => m.pubkey.equals(arbiter)).length).toBeGreaterThanOrEqual(1);
    expect(r!.keys.some((m) => m.pubkey.equals(arbiter) && m.isSigner)).toBe(true);
  });
});
