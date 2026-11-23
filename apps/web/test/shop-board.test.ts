// Pure views behind /kedai, /timbang and the home page numbers, with time pinned.
import { ClaimStatus, WarrantyStatus, type ShopAccount } from "@kekal/sdk";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { canRespond, claimDeadline, programStats, shopSummary, sortWarranties, type ClaimRow } from "../src/lib/shop/board";

const key = () => Keypair.generate().publicKey;
function shop(over: Partial<ShopAccount> = {}): ShopAccount {
  return {
    owner: key(), mint: key(), vault: key(), arbiter: key(),
    freeBalance: 10n, lockedBalance: 5n,
    responseSecs: 60, repairSecs: 120, disputeSecs: 60, heartbeatSecs: 1000, graceSecs: 200,
    lastSeen: 5000, status: 0, dormantAt: 0, nextWarrantyId: 3n, activeWarranties: 2, openClaims: 1,
    issued: 3n, paidCount: 1n, paidAmount: 7n, releasedAmount: 0n, flags: 0, profileHash: new Uint8Array(32), createdAt: 1,
    ...over,
  };
}

describe("shop board views", () => {
  it("serialises amounts as strings and places the silence moment after heartbeat and grace", () => {
    const s = shopSummary("addr", shop());
    expect(s).toMatchObject({ free: "10", locked: "5", nextWarrantyId: "3", silentAt: 6200 });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("picks the deadline that matters for each claim state", () => {
    const base = { filedAt: 100, repairDeadline: 900, disputeDeadline: 800 };
    expect(claimDeadline({ ...base, status: ClaimStatus.Pending }, shop())).toBe(160);
    expect(claimDeadline({ ...base, status: ClaimStatus.Accepted }, shop())).toBe(900);
    expect(claimDeadline({ ...base, status: ClaimStatus.Rejected }, shop())).toBe(800);
    expect(claimDeadline({ ...base, status: ClaimStatus.Disputed }, shop())).toBe(0);
  });

  it("lets the shop answer only a pending claim before its window closes, by the chain clock", () => {
    const c: ClaimRow = { address: "c", warranty: "w", warrantyId: "0", index: 0, status: ClaimStatus.Pending, filedAt: 100, deadline: 160 };
    expect(canRespond(c, 159)).toBe(true);
    expect(canRespond(c, 160)).toBe(false);
    expect(canRespond({ ...c, status: ClaimStatus.Accepted }, 120)).toBe(false);
  });

  it("orders cards newest first by numeric id", () => {
    const row = (id: string) => ({ address: id, id, holder: "h", reserve: "1", issuedAt: 0, expiresAt: 0, status: 0 });
    expect(sortWarranties([row("2"), row("10"), row("9")]).map((r) => r.id)).toEqual(["10", "9", "2"]);
  });

  it("counts shops, running cards, locked reserve and paid claims", () => {
    const w = (status: number) => ({ status });
    const stats = programStats([shop(), shop({ lockedBalance: 20n, paidCount: 4n })], [w(WarrantyStatus.Active), w(WarrantyStatus.Claimed), w(WarrantyStatus.PaidOut), w(WarrantyStatus.Released)]);
    expect(stats).toEqual({ shops: 2, activeWarranties: 2, locked: "25", paidClaims: "5" });
  });
});
