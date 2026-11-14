import { describe, expect, it } from "vitest";
import {
  ClaimStatus,
  isClaimOpen,
  isDue,
  isWarrantyFinal,
  scheduleShop,
  scheduleWarranty,
  ShopStatus,
  statusKey,
  WarrantyStatus,
  type ClaimTimes,
  type ShopTimes,
} from "../src/status";

const shop: ShopTimes = {
  status: ShopStatus.Active,
  lastSeen: 1_000,
  dormantAt: 0,
  responseSecs: 60,
  heartbeatSecs: 120,
  graceSecs: 60,
  disputeSecs: 60,
};
const active = { status: WarrantyStatus.Active, expiresAt: 5_000 };
const claimed = { status: WarrantyStatus.Claimed, expiresAt: 5_000 };
const claim = (status: number, extra: Partial<ClaimTimes> = {}): ClaimTimes => ({
  status,
  filedAt: 2_000,
  repairDeadline: 0,
  disputeDeadline: 0,
  escalatedAt: 0,
  ...extra,
});
const T = 300;

describe("schedule (mirrors program deadlines, strict >)", () => {
  it("settle_unanswered: t0+R not due, t0+R+1 due (Appendix A vector)", () => {
    const s = scheduleWarranty(shop, claimed, claim(ClaimStatus.Pending), T);
    expect(s).toEqual({ action: "settleUnanswered", dueAt: 2_061 });
    expect(isDue(s, 2_060)).toBe(false);
    expect(isDue(s, 2_061)).toBe(true);
  });

  it("close_stale after rejection and after an unconfirmed repair", () => {
    expect(scheduleWarranty(shop, claimed, claim(ClaimStatus.Rejected, { disputeDeadline: 2_100 }), T)).toEqual({
      action: "closeStale",
      dueAt: 2_101,
    });
    expect(scheduleWarranty(shop, claimed, claim(ClaimStatus.Accepted, { repairDeadline: 2_200 }), T)).toEqual({
      action: "closeStale",
      dueAt: 2_261,
    });
  });

  it("settle_stale_dispute after the dispute timeout", () => {
    expect(scheduleWarranty(shop, claimed, claim(ClaimStatus.Disputed, { escalatedAt: 3_000 }), T)).toEqual({
      action: "settleStaleDispute",
      dueAt: 3_301,
    });
  });

  it("declare_dormant after heartbeat + grace, never for a dormant shop", () => {
    expect(scheduleShop(shop)).toEqual({ action: "declareDormant", dueAt: 1_181 });
    expect(scheduleShop({ ...shop, status: ShopStatus.Dormant })).toBeNull();
  });

  it("dormant shop: live warranty → claim_orphan; expired before dormancy → release_expired", () => {
    const dormant = { ...shop, status: ShopStatus.Dormant, dormantAt: 4_000 };
    expect(scheduleWarranty(dormant, active, null, T)?.action).toBe("claimOrphan");
    expect(scheduleWarranty(dormant, claimed, claim(ClaimStatus.Pending), T)?.action).toBe("claimOrphan");
    expect(scheduleWarranty(dormant, { ...active, expiresAt: 4_000 }, null, T)?.action).toBe("claimOrphan");
    expect(scheduleWarranty(dormant, { ...active, expiresAt: 3_999 }, null, T)).toEqual({
      action: "releaseExpired",
      dueAt: 4_000,
    });
  });

  it("active warranty with no claim → release after expiry; final states → nothing", () => {
    expect(scheduleWarranty(shop, active, null, T)).toEqual({ action: "releaseExpired", dueAt: 5_001 });
    expect(scheduleWarranty(shop, { ...active, status: WarrantyStatus.PaidOut }, null, T)).toBeNull();
    expect(scheduleWarranty(shop, { ...active, status: WarrantyStatus.Released }, null, T)).toBeNull();
    expect(scheduleWarranty(shop, claimed, null, T)).toBeNull();
  });
});

describe("status helpers", () => {
  it("open and final sets", () => {
    const open = Object.values(ClaimStatus).filter(isClaimOpen);
    expect(open).toEqual([0, 1, 2, 3]);
    expect(isWarrantyFinal(WarrantyStatus.PaidOut)).toBe(true);
    expect(isWarrantyFinal(WarrantyStatus.Claimed)).toBe(false);
  });

  it("locale keys", () => {
    expect(statusKey.claim(ClaimStatus.PaidTimeout)).toBe("status.claim.paidTimeout");
    expect(statusKey.warranty(WarrantyStatus.PaidOut)).toBe("status.warranty.paidOut");
    expect(statusKey.shop(ShopStatus.Dormant)).toBe("status.shop.dormant");
    expect(() => statusKey.claim(99)).toThrow(RangeError);
  });
});
