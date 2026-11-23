import { ClaimStatus, ShopStatus, WarrantyStatus } from "@kekal/sdk";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { dueDormant, dueWarrantyActions, heartbeatDue } from "../src/plan";
import { shop, warranty } from "./fixtures";

const owner = () => Keypair.generate().publicKey;

describe("dueDormant", () => {
  it("is due one second after heartbeat + grace, never for a dormant shop", () => {
    const s = shop(owner()); // lastSeen 1000, heartbeat 120, grace 60 → due at 1181
    expect(dueDormant([s], 1_180)).toEqual([]);
    expect(dueDormant([s], 1_181)).toEqual([s.key]);
    const d = shop(owner(), { status: ShopStatus.Dormant, dormantAt: 1_200 });
    expect(dueDormant([d], 9_999)).toEqual([]);
  });
});

describe("dueWarrantyActions", () => {
  it("picks the step the program accepts, oldest first, capped", () => {
    const s = shop(owner());
    const map = new Map([[s.key.toBase58(), s.account]]);
    const pending = warranty(s.key, {}, { filedAt: 1_100 }); // settle at 1161
    const expiring = warranty(s.key, { expiresAt: 1_050 }); // release at 1051
    const disputed = warranty(s.key, {}, { status: ClaimStatus.Disputed, escalatedAt: 1_000 }); // timeout 300 → 1301
    const quiet = warranty(s.key); // nothing due
    const all = [pending, expiring, disputed, quiet];
    expect(dueWarrantyActions(map, all, 1_200, 300, 10).map((a) => a.action)).toEqual(["releaseExpired", "settleUnanswered"]);
    expect(dueWarrantyActions(map, all, 1_301, 300, 10).map((a) => a.action)).toEqual([
      "releaseExpired",
      "settleUnanswered",
      "settleStaleDispute",
    ]);
    expect(dueWarrantyActions(map, all, 1_301, 300, 1)).toHaveLength(1);
    const settle = dueWarrantyActions(map, [pending], 1_161, 300, 10)[0]!;
    expect(settle.claim?.equals(pending.claim!.key)).toBe(true);
  });

  it("a dormant shop pays every live warranty as an orphan, open claim passed along", () => {
    const s = shop(owner(), { status: ShopStatus.Dormant, dormantAt: 2_000 });
    const map = new Map([[s.key.toBase58(), s.account]]);
    const active = warranty(s.key);
    const claimed = warranty(s.key, {}, { status: ClaimStatus.Rejected, disputeDeadline: 5_000 });
    const acts = dueWarrantyActions(map, [active, claimed], 2_000, 300, 10);
    expect(acts.map((a) => a.action)).toEqual(["claimOrphan", "claimOrphan"]);
    expect(acts.find((a) => a.warranty.equals(active.key))?.claim).toBeNull();
    expect(acts.find((a) => a.warranty.equals(claimed.key))?.claim?.equals(claimed.claim!.key)).toBe(true);
  });

  it("skips warranties whose shop was not loaded and final warranties", () => {
    const s = shop(owner());
    const stray = warranty(owner(), { expiresAt: 10 });
    const paid = warranty(s.key, { status: WarrantyStatus.PaidOut, expiresAt: 10 });
    expect(dueWarrantyActions(new Map([[s.key.toBase58(), s.account]]), [stray, paid], 9_999, 300, 10)).toEqual([]);
  });
});

describe("heartbeatDue", () => {
  it("first pass, then every N seconds", () => {
    expect(heartbeatDue(undefined, 100, 30)).toBe(true);
    expect(heartbeatDue(100, 129, 30)).toBe(false);
    expect(heartbeatDue(100, 130, 30)).toBe(true);
  });
});
