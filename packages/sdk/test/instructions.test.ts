import { BorshInstructionCoder } from "@anchor-lang/core";
import { Connection, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { describe, expect, it } from "vitest";
import { claimPda, configPda, ix, KEKAL_IDL, readOnlyProgram, shopPda, vaultPda, warrantyPda } from "../src";
import type { ConfigLimits } from "../src";

const p = readOnlyProgram(new Connection("http://127.0.0.1:1"));
const pid = p.programId;
const key = () => Keypair.generate().publicKey;
const h = new Uint8Array(32).fill(7);

const owner = key();
const holder = key();
const mint = key();
const payer = key();
const shop = shopPda(pid, owner);
const warranty = warrantyPda(pid, shop, 3n);
const claim = claimPda(pid, warranty, 1);
const ref = { shop, warranty, claim };
const pay = { payer, shop, mint, holder };
const limits: ConfigLimits = {
  minResponseSecs: 60,
  maxResponseSecs: 90,
  minRepairSecs: 60,
  maxRepairSecs: 90,
  minDisputeSecs: 60,
  maxDisputeSecs: 90,
  minHeartbeatSecs: 60,
  maxHeartbeatSecs: 90,
  maxGraceSecs: 30,
  minTermSecs: 300,
  maxTermSecs: 900,
  disputeTimeoutSecs: 300,
  claimCooldownSecs: 30,
  maxClaimsPerWarranty: 8,
};
const params = { defaultArbiter: key(), assessor: key(), limits, allowedMints: [mint], paused: false };
const windows = { responseSecs: 60, repairSecs: 60, disputeSecs: 60, heartbeatSecs: 60, graceSecs: 0 };

const builds = {
  initConfig: () => ix.initConfig(p, { admin: owner, params }),
  setConfig: () => ix.setConfig(p, { admin: owner, params }),
  createShop: () => ix.createShop(p, { owner, mint, windows, arbiter: null, profileHash: h }),
  updateShopProfile: () => ix.updateShopProfile(p, { owner, profileHash: h }),
  deposit: () => ix.deposit(p, { owner, mint, ownerToken: key(), amount: 5n }),
  withdraw: () => ix.withdraw(p, { owner, mint, ownerToken: key(), amount: 5n }),
  issueWarranty: () =>
    ix.issueWarranty(p, {
      owner,
      warrantyId: 3n,
      params: { holder, reserve: 18_446_744_073_709_551_615n, termSecs: 300, termsHash: h, productHash: h },
    }),
  heartbeat: () => ix.heartbeat(p, { owner }),
  transferHolder: () => ix.transferHolder(p, { holder, warranty, newHolder: key() }),
  fileClaim: () => ix.fileClaim(p, { payer, holder, shop, warranty, claimIndex: 1, evidenceHash: h }),
  respondClaim: () => ix.respondClaim(p, { owner, warranty, claim, accept: true, responseHash: h }),
  confirmResolved: () => ix.confirmResolved(p, { holder, ...ref }),
  escalate: () => ix.escalate(p, { holder, ...ref }),
  resolveDispute: () => ix.resolveDispute(p, { arbiter: key(), buyerWins: true, ...ref, ...pay }),
  settleUnanswered: () => ix.settleUnanswered(p, { ...ref, ...pay }),
  closeStale: () => ix.closeStale(p, ref),
  settleStaleDispute: () => ix.settleStaleDispute(p, { ...ref, ...pay }),
  declareDormant: () => ix.declareDormant(p, { shop }),
  claimOrphan: () => ix.claimOrphan(p, { ...pay, warranty, claim: null }),
  releaseExpired: () => ix.releaseExpired(p, { shop, warranty }),
};

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe("instruction builders", () => {
  it("cover every instruction in the IDL", () => {
    expect(Object.keys(builds).map(snake).sort()).toEqual(KEKAL_IDL.instructions.map((i) => i.name).sort());
  });

  for (const [name, build] of Object.entries(builds)) {
    it(`${name} encodes and decodes`, async () => {
      const built = await build();
      expect(built.programId.equals(pid)).toBe(true);
      const decoded = (p.coder.instruction as BorshInstructionCoder).decode(Buffer.from(built.data));
      expect(decoded?.name).toBe(name);
    });
  }

  it("derive PDAs into the expected slots", async () => {
    const keys = (await builds.issueWarranty()).keys.map((k) => k.pubkey.toBase58());
    expect(keys).toEqual(
      expect.arrayContaining([configPda(pid), shop, warrantyPda(pid, shop, 3n)].map((k) => k.toBase58())),
    );
    const payout = (await builds.settleUnanswered()).keys.map((k) => k.pubkey.toBase58());
    expect(payout).toContain(vaultPda(pid, shop).toBase58());
    expect(payout).toContain(getAssociatedTokenAddressSync(mint, holder, true).toBase58());
    const filed = (await builds.fileClaim()).keys;
    expect(filed.find((k) => k.pubkey.equals(claim))?.isWritable).toBe(true);
    expect(filed.find((k) => k.pubkey.equals(holder))?.isSigner).toBe(true);
  });

  it("marks an absent optional claim with the program id", async () => {
    const keys = (await builds.claimOrphan()).keys;
    expect(keys[2]?.pubkey.equals(pid)).toBe(true);
  });

  it("rejects malformed input before encoding", () => {
    expect(() => ix.updateShopProfile(p, { owner, profileHash: new Uint8Array(31) })).toThrow(RangeError);
    expect(() =>
      ix.setConfig(p, { admin: owner, params: { ...params, allowedMints: [key(), key(), key(), key(), key()] } }),
    ).toThrow(RangeError);
  });
});

