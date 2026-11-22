import { ix } from "@kekal/sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, createTransferInstruction,
  getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { AddressLookupTableAccount, Keypair, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { checkRelayTx } from "../src/lib/relay/policy";
import { b64, build, claim, holder, mint, policy, program, relayer, shop, warranty } from "./relay-fixtures";

const P = policy();
const refusal = (tx: string, p = P) => {
  const v = checkRelayTx(tx, p);
  return v.ok ? "ok" : v.error;
};
const transferHolder = (who = holder.publicKey) =>
  ix.transferHolder(program, { holder: who, warranty, newHolder: Keypair.generate().publicKey });
const payout = { payer: relayer.publicKey, mint, holder: holder.publicKey };
const holderAta = getAssociatedTokenAddressSync(mint, holder.publicKey, true);
const sendOut = (from = holderAta, authority = holder.publicKey, m = mint) =>
  createTransferCheckedInstruction(from, m, Keypair.generate().publicKey, authority, 1_000_000n, 6);

describe("relay policy: what the relayer pays for", () => {
  it("transfer_holder signed by the card key", async () => {
    const v = checkRelayTx(b64(build([await transferHolder()], [holder])), P);
    expect(v.ok && v.signers).toEqual([holder.publicKey.toBase58()]);
  });
  it("file_claim with the relayer as rent payer", async () => {
    const i = await ix.fileClaim(program, {
      payer: relayer.publicKey, holder: holder.publicKey, shop, warranty, claimIndex: 0, evidenceHash: new Uint8Array(32),
    });
    expect(refusal(b64(build([i], [holder])))).toBe("ok");
  });
  it("permissionless settle with the relayer in payout.payer, no other signer", async () => {
    const v = checkRelayTx(b64(build([await ix.settleUnanswered(program, { shop, warranty, claim, ...payout })], [])), P);
    expect(v.ok && v.signers).toEqual([]);
  });
  it("declare_dormant then claim_orphan in one transaction", async () => {
    const a = await ix.declareDormant(program, { shop });
    const b = await ix.claimOrphan(program, { ...payout, shop, warranty, claim: null });
    expect(refusal(b64(build([a, b], [])))).toBe("ok");
  });
  it("create own associated account and send an allowed mint out of it", () => {
    const create = createAssociatedTokenAccountIdempotentInstruction(relayer.publicKey, holderAta, holder.publicKey, mint);
    expect(refusal(b64(build([create, sendOut()], [holder])))).toBe("ok");
  });
});

describe("relay policy: malicious transactions", () => {
  it("someone else pays the fee", async () => {
    expect(refusal(b64(build([await transferHolder()], [holder], { payer: holder.publicKey })))).toBe("fee_payer");
  });
  it("drains the relayer with a system transfer", () => {
    const steal = SystemProgram.transfer({ fromPubkey: relayer.publicKey, toPubkey: holder.publicKey, lamports: 1e9 });
    expect(refusal(b64(build([steal], [])))).toBe("program_not_allowed");
  });
  it("hides a system transfer behind an allowed instruction", async () => {
    const steal = SystemProgram.transfer({ fromPubkey: relayer.publicKey, toPubkey: holder.publicKey, lamports: 1 });
    expect(refusal(b64(build([await transferHolder(), steal], [holder])))).toBe("program_not_allowed");
  });
  it("owner-only Kekal instructions (withdraw, respond_claim, heartbeat)", async () => {
    const owner = holder.publicKey;
    const w = await ix.withdraw(program, { owner, mint, ownerToken: holderAta, amount: 1n });
    const r = await ix.respondClaim(program, { owner, warranty, claim, accept: true, responseHash: new Uint8Array(32) });
    const h = await ix.heartbeat(program, { owner });
    for (const i of [w, r, h]) expect(refusal(b64(build([i], [holder])))).toBe("instruction_not_allowed");
  });
  it("an allowed instruction left out of config is refused", async () => {
    const tx = b64(build([await transferHolder()], [holder]));
    expect(refusal(tx, policy({ allowedInstructions: ["file_claim"] }))).toBe("instruction_not_allowed");
  });
  it("the relayer stands as holder", async () => {
    expect(refusal(b64(build([await transferHolder(relayer.publicKey)], [])))).toBe("relayer_misuse");
  });
  it("the relayer stands as payout holder", async () => {
    const i = await ix.claimOrphan(program, { ...payout, shop, holder: relayer.publicKey, warranty, claim: null });
    expect(refusal(b64(build([i], [])))).toBe("relayer_misuse");
  });
  it("the relayer is slipped in as an extra account", async () => {
    const i = await ix.declareDormant(program, { shop });
    i.keys.push({ pubkey: relayer.publicKey, isSigner: false, isWritable: true });
    expect(refusal(b64(build([i], [])))).toBe("relayer_misuse");
  });
  it("token transfer signed by the relayer", () => {
    const fromRelayer = getAssociatedTokenAddressSync(mint, relayer.publicKey);
    expect(refusal(b64(build([sendOut(fromRelayer, relayer.publicKey)], [])))).toBe("relayer_misuse");
  });
  it("token transfer out of an account that is not the signer's associated account", () => {
    const other = getAssociatedTokenAddressSync(mint, Keypair.generate().publicKey);
    expect(refusal(b64(build([sendOut(other)], [holder])))).toBe("bad_account");
  });
  it("token transfer of a mint that is not allowed", () => {
    const m = Keypair.generate().publicKey;
    const from = getAssociatedTokenAddressSync(m, holder.publicKey);
    expect(refusal(b64(build([sendOut(from, holder.publicKey, m)], [holder])))).toBe("mint_not_allowed");
  });
  it("unchecked Transfer (no mint to check)", () => {
    const t = createTransferInstruction(holderAta, Keypair.generate().publicKey, holder.publicKey, 1n);
    expect(refusal(b64(build([t], [holder])))).toBe("instruction_not_allowed");
  });
  it("Token-2022 program", () => {
    const t = createTransferCheckedInstruction(holderAta, mint, holder.publicKey, holder.publicKey, 1n, 6, [], TOKEN_2022_PROGRAM_ID);
    expect(refusal(b64(build([t], [holder])))).toBe("program_not_allowed");
  });
  it("associated account for a mint that is not allowed, or at a wrong address", () => {
    const m = Keypair.generate().publicKey;
    const bad = createAssociatedTokenAccountIdempotentInstruction(
      relayer.publicKey, getAssociatedTokenAddressSync(m, holder.publicKey), holder.publicKey, m);
    expect(refusal(b64(build([bad], [])))).toBe("mint_not_allowed");
    const wrong = createAssociatedTokenAccountIdempotentInstruction(relayer.publicKey, Keypair.generate().publicKey, holder.publicKey, mint);
    expect(refusal(b64(build([wrong], [])))).toBe("bad_account");
  });
  it("holder signature missing", async () => {
    expect(refusal(b64(build([await transferHolder()], [])))).toBe("missing_signature");
  });
  it("holder signature tampered", async () => {
    const tx = build([await transferHolder()], [holder]);
    const sig = tx.signatures[1]!;
    sig[0] = sig[0]! ^ 0xff;
    expect(refusal(b64(tx))).toBe("bad_signature");
  });
  it("too many instructions", async () => {
    const i = await ix.declareDormant(program, { shop });
    expect(refusal(b64(build([i, i, i, i, i], [])))).toBe("too_many_instructions");
  });
  it("address lookup tables", async () => {
    const table = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [shop] },
    });
    expect(refusal(b64(build([await ix.declareDormant(program, { shop })], [], { tables: [table] })))).toBe("lookup_tables");
  });
  it("garbage, non-base64 and oversize input", async () => {
    expect(refusal("not base64!")).toBe("malformed");
    expect(refusal(Buffer.from("hello").toString("base64"))).toBe("malformed");
    expect(refusal(b64(build([await transferHolder()], [holder])), policy({ maxTxBytes: 100 }))).toBe("too_large");
  });
});
