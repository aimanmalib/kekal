import { resolve } from "node:path";
import { ix } from "@kekal/sdk";
import { Keypair, type VersionedTransaction } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import { openSqlite } from "@kekal/server";
import type { DataStore } from "@kekal/server";
import { verifyEd25519 } from "../src/lib/ed25519";
import { relay, type RelayDeps } from "../src/lib/relay/service";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { b64, build, holder, mint, policy, program, relayer, shop, warranty, withCaller } from "./relay-fixtures";

const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");
const stores: DataStore[] = [];
afterEach(() => {
  while (stores.length) stores.pop()!.close();
});

function deps(over: Partial<RelayDeps> = {}) {
  const store = openSqlite(":memory:", MIGRATIONS);
  stores.push(store);
  const sent: VersionedTransaction[] = [];
  const d: RelayDeps = {
    store,
    policy: policy(),
    limits: { perHolderPerHour: 10, perIpPerHour: 30, globalPerDay: 1000, accountCreatesPerDay: 100 },
    relayer,
    send: async (tx) => {
      sent.push(tx);
      return "sig" + sent.length;
    },
    now: 1_800_000_000,
    ...over,
  };
  return { d, sent };
}
const holderTx = async (kp = holder) =>
  b64(build([await ix.transferHolder(program, { holder: kp.publicKey, warranty, newHolder: Keypair.generate().publicKey })], [kp]));
const caller = Keypair.generate();
const openTx = async () => b64(build([withCaller(await ix.declareDormant(program, { shop }), caller)], [caller]));
/** Holder sends to a fresh address and the relayer pays for that address's token account. */
const sendNewTx = () => {
  const owner = Keypair.generate().publicKey;
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const create = createAssociatedTokenAccountIdempotentInstruction(relayer.publicKey, ata, owner, mint);
  const send = createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint, holder.publicKey, true), mint, ata, holder.publicKey, 1n, 6);
  return b64(build([create, send], [holder]));
};

describe("relay service", () => {
  it("signs as fee payer and sends; the holder signature is kept", async () => {
    const { d, sent } = deps();
    expect(await relay({ tx: await holderTx() }, "1.1.1.1", d)).toEqual({ ok: true, signature: "sig1" });
    const tx = sent[0]!;
    const msg = tx.message.serialize();
    expect(verifyEd25519(relayer.publicKey.toBytes(), msg, tx.signatures[0]!)).toBe(true);
    expect(verifyEd25519(holder.publicKey.toBytes(), msg, tx.signatures[1]!)).toBe(true);
  });
  it("a refused transaction never reaches the network and spends no quota", async () => {
    const { d, sent } = deps({ limits: { perHolderPerHour: 10, perIpPerHour: 1, globalPerDay: 1000, accountCreatesPerDay: 100 } });
    const bad = await relay({ tx: b64(build([await ix.declareDormant(program, { shop })], [], { payer: holder.publicKey })) }, "ip", d);
    expect(bad).toMatchObject({ ok: false, status: 400, error: "fee_payer" });
    expect(await relay({ tx: await openTx() }, "ip", d)).toMatchObject({ ok: true });
    expect(sent).toHaveLength(1);
  });
  it("body without tx", async () => {
    const { d } = deps();
    expect(await relay({}, "ip", d)).toMatchObject({ status: 400, error: "bad_request" });
    expect(await relay(null, "ip", d)).toMatchObject({ status: 400, error: "bad_request" });
  });
  it("10 per holder per hour, across IPs; the next hour opens again", async () => {
    const { d } = deps();
    for (let i = 0; i < 10; i++) expect(await relay({ tx: await holderTx() }, `10.0.0.${i}`, d)).toMatchObject({ ok: true });
    expect(await relay({ tx: await holderTx() }, "10.0.1.1", d)).toMatchObject({ status: 429, error: "rate_holder" });
    expect(await relay({ tx: await holderTx(Keypair.generate()) }, "10.0.1.2", d)).toMatchObject({ ok: true });
    expect(await relay({ tx: await holderTx() }, "10.0.1.3", { ...d, now: d.now + 3600 })).toMatchObject({ ok: true });
  });
  it("30 per IP per hour, whatever the holder", async () => {
    const { d } = deps();
    for (let i = 0; i < 30; i++) expect(await relay({ tx: await holderTx(Keypair.generate()) }, "9.9.9.9", d)).toMatchObject({ ok: true });
    expect(await relay({ tx: await openTx() }, "9.9.9.9", d)).toMatchObject({ status: 429, error: "rate_ip" });
    expect(await relay({ tx: await openTx() }, "9.9.9.8", d)).toMatchObject({ ok: true });
  });
  it("global daily cap from config", async () => {
    const { d } = deps({ limits: { perHolderPerHour: 10, perIpPerHour: 30, globalPerDay: 2, accountCreatesPerDay: 100 } });
    expect(await relay({ tx: await openTx() }, "a", d)).toMatchObject({ ok: true });
    expect(await relay({ tx: await openTx() }, "b", d)).toMatchObject({ ok: true });
    expect(await relay({ tx: await openTx() }, "c", d)).toMatchObject({ status: 429, error: "rate_global" });
  });
  it("daily cap on associated accounts the relayer pays rent for", async () => {
    const { d, sent } = deps({ limits: { perHolderPerHour: 10, perIpPerHour: 30, globalPerDay: 1000, accountCreatesPerDay: 2 } });
    expect(await relay({ tx: sendNewTx() }, "a", d)).toMatchObject({ ok: true });
    expect(await relay({ tx: sendNewTx() }, "b", d)).toMatchObject({ ok: true });
    expect(await relay({ tx: sendNewTx() }, "c", d)).toMatchObject({ status: 429, error: "rate_accounts" });
    expect(await relay({ tx: await openTx() }, "d", d)).toMatchObject({ ok: true });
    expect(sent).toHaveLength(3);
  });
  it("claims the relayer pays rent for draw on the same daily account budget", async () => {
    const { d, sent } = deps({ limits: { perHolderPerHour: 10, perIpPerHour: 30, globalPerDay: 1000, accountCreatesPerDay: 2 } });
    const claimTx = async (i: number) =>
      b64(build([await ix.fileClaim(program, {
        payer: relayer.publicKey, holder: holder.publicKey, shop, warranty, claimIndex: i, evidenceHash: new Uint8Array(32),
      })], [holder]));
    expect(await relay({ tx: await claimTx(0) }, "a", d)).toMatchObject({ ok: true });
    expect(await relay({ tx: await claimTx(1) }, "b", d)).toMatchObject({ ok: true });
    expect(await relay({ tx: await claimTx(2) }, "c", d)).toMatchObject({ status: 429, error: "rate_accounts" });
    expect(sent).toHaveLength(2);
  });
  it("RPC failure is reported, not thrown", async () => {
    const { d } = deps({ send: async () => Promise.reject(new Error("Blockhash not found")) });
    expect(await relay({ tx: await openTx() }, "ip", d)).toEqual({
      ok: false, status: 502, error: "send_failed", detail: "Blockhash not found",
    });
  });
});
