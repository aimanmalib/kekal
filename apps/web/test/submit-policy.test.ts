// POST /api/submit refuses everything but a wallet-signed, wallet-paid seller or arbiter transaction.
import { IDL_PROGRAM_ID, ix } from "@kekal/sdk";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { checkSubmitTx, type SubmitPolicy } from "../src/lib/submit/policy";
import { submit } from "../src/lib/submit/service";
import { b64, build, mint, program, relayer, warranty, holder } from "./relay-fixtures";

const owner = Keypair.generate();
const policy: SubmitPolicy = {
  programId: IDL_PROGRAM_ID,
  forbiddenKeys: [relayer.publicKey],
  allowedInstructions: ["create_shop", "update_shop_profile", "deposit", "withdraw", "issue_warranty", "heartbeat", "respond_claim", "resolve_dispute"],
  maxInstructions: 4,
  maxTxBytes: 1232,
};
const heartbeat = () => ix.heartbeat(program, { owner: owner.publicKey });
const signed = async (ixs: Parameters<typeof build>[0], signers = [owner]) => b64(build(ixs, signers, { payer: owner.publicKey }));

describe("checkSubmitTx", () => {
  it("passes a heartbeat the owner signed and pays for", async () => {
    const v = checkSubmitTx(await signed([await heartbeat()]), policy);
    expect(v.ok && v.feePayer).toBe(owner.publicKey.toBase58());
  });

  it("passes a withdraw with an idempotent account creation and a compute budget", async () => {
    const ata = getAssociatedTokenAddressSync(mint, owner.publicKey, true);
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ata, owner.publicKey, mint),
      await ix.withdraw(program, { owner: owner.publicKey, mint, ownerToken: ata, amount: 1n }),
    ];
    expect(checkSubmitTx(await signed(ixs), policy).ok).toBe(true);
  });

  it("refuses holder instructions: those go through the relayer", async () => {
    const t = await ix.transferHolder(program, { holder: owner.publicKey, warranty, newHolder: holder.publicKey });
    expect(checkSubmitTx(await signed([t]), policy)).toMatchObject({ ok: false, error: "instruction_not_allowed" });
  });

  it("refuses other programs, and transactions with no Kekal instruction", async () => {
    const pay = SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: holder.publicKey, lamports: 1 });
    expect(checkSubmitTx(await signed([await heartbeat(), pay]), policy)).toMatchObject({ ok: false, error: "program_not_allowed" });
    const cb = ComputeBudgetProgram.setComputeUnitLimit({ units: 1 });
    expect(checkSubmitTx(await signed([cb]), policy)).toMatchObject({ ok: false, error: "no_kekal_instruction" });
  });

  it("refuses any transaction naming the relayer key", async () => {
    const pay = SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: relayer.publicKey, lamports: 1 });
    expect(checkSubmitTx(await signed([await heartbeat(), pay]), policy)).toMatchObject({ ok: false, error: "server_key" });
  });

  it("refuses unsigned, wrongly signed, oversized and malformed input", async () => {
    expect(checkSubmitTx(await signed([await heartbeat()], []), policy)).toMatchObject({ ok: false, error: "missing_signature" });
    const tx = build([await heartbeat()], [owner], { payer: owner.publicKey });
    const sig = tx.signatures[0]!;
    sig[5] = sig[5]! ^ 1;
    expect(checkSubmitTx(b64(tx), policy)).toMatchObject({ ok: false, error: "bad_signature" });
    expect(checkSubmitTx(await signed([await heartbeat()]), { ...policy, maxTxBytes: 100 })).toMatchObject({ ok: false, error: "too_large" });
    const five = await Promise.all(Array.from({ length: 5 }, () => heartbeat()));
    expect(checkSubmitTx(await signed(five), policy)).toMatchObject({ ok: false, error: "too_many_instructions" });
    expect(checkSubmitTx("not base64!", policy)).toMatchObject({ ok: false, error: "malformed" });
    expect(checkSubmitTx(12, policy)).toMatchObject({ ok: false, error: "malformed" });
  });
});

describe("submit", () => {
  const store = () => {
    const hits = new Map<string, number>();
    return { hit: async (k: string) => hits.set(k, (hits.get(k) ?? 0) + 1).get(k)! };
  };

  it("sends a passing transaction and reports the RPC refusal otherwise", async () => {
    const body = { tx: await signed([await heartbeat()]) };
    const deps = { store: store(), policy, perIpPerHour: 5, now: 0 };
    expect(await submit(body, "1.1.1.1", { ...deps, send: async () => "sig" })).toEqual({ ok: true, signature: "sig" });
    const r = await submit(body, "1.1.1.1", { ...deps, send: async () => Promise.reject(new Error("insufficient funds")) });
    expect(r).toMatchObject({ ok: false, status: 502, error: "send_failed", detail: "insufficient funds" });
  });

  it("limits each IP per hour, before any work", async () => {
    const deps = { store: store(), policy, perIpPerHour: 1, now: 0, send: async () => "sig" };
    expect((await submit({ tx: "x" }, "2.2.2.2", deps)).ok).toBe(false);
    expect(await submit({ tx: "x" }, "2.2.2.2", deps)).toMatchObject({ status: 429, error: "rate_ip" });
    expect(await submit({}, "3.3.3.3", deps)).toMatchObject({ status: 400, error: "bad_request" });
  });
});
