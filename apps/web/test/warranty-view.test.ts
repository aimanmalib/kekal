import { ClaimStatus, ShopStatus, WarrantyStatus } from "@kekal/sdk";
import { describe, expect, it } from "vitest";
import { holderActions, keyState } from "../src/lib/warranty/view";
import { T0, claimAcc, entry, shopAcc, view, warrantyAcc } from "./warranty-fixtures";

describe("warranty view: the next step anyone may send", () => {
  it("an unanswered claim settles one second after the response window", () => {
    const v = view({ warranty: warrantyAcc({ status: WarrantyStatus.Claimed, claimCount: 1 }), claim: claimAcc() });
    expect(v.claim?.open).toBe(true);
    expect(v.next).toEqual({ action: "settleUnanswered", dueAt: T0 + 10 + 60 + 1 });
  });

  it("a shop past its check-in window is declared dormant before anything later is due", () => {
    const v = view();
    expect(v.next).toEqual({ action: "declareDormant", dueAt: T0 + 120 + 60 + 1 });
  });

  it("a dormant shop pays the orphan payout at once", () => {
    const v = view({ shop: shopAcc({ status: ShopStatus.Dormant, dormantAt: T0 + 500 }) });
    expect(v.next).toEqual({ action: "claimOrphan", dueAt: T0 + 500 });
  });

  it("a settled warranty has no next step and shows the payout reason from the ReservePaid event", () => {
    const paid = entry({ events: ["ReservePaid", "ClaimStatusChanged"], blockTime: T0 + 99, paid: { amount: "25000000", claimStatus: ClaimStatus.PaidOrphan } });
    const v = view({ warranty: warrantyAcc({ status: WarrantyStatus.PaidOut }), timeline: [paid, entry({ events: ["WarrantyIssued"] })] });
    expect(v.next).toBeNull();
    expect(v.payout).toEqual({ amount: "25000000", statusKey: "status.claim.paidOrphan", at: T0 + 99 });
  });

  it("activation time is the oldest successful holder transfer", () => {
    const v = view({
      timeline: [
        entry({ events: ["HolderTransferred"], blockTime: T0 + 30 }),
        entry({ events: ["HolderTransferred"], blockTime: T0 + 20, failed: true }),
        entry({ events: ["HolderTransferred"], blockTime: T0 + 10 }),
        entry({ events: ["WarrantyIssued"], blockTime: T0 }),
      ],
    });
    expect(v.activatedAt).toBe(T0 + 10);
  });
});

describe("warranty view: what the holder may do", () => {
  it("files a claim only while active, in term, under the claim cap and after the cooldown", () => {
    expect(holderActions(view(), T0 + 1)).toEqual(["fileClaim"]);
    expect(holderActions(view({ warranty: warrantyAcc({ lastClaimClosedAt: T0 }) }), T0 + 50)).toEqual([]);
    expect(holderActions(view({ warranty: warrantyAcc({ lastClaimClosedAt: T0 }) }), T0 + 100)).toEqual(["fileClaim"]);
    expect(holderActions(view({ warranty: warrantyAcc({ claimCount: 3 }) }), T0 + 1)).toEqual([]);
    expect(holderActions(view(), T0 + 86_400 * 365 + 1)).toEqual([]);
    expect(holderActions(view({ shop: shopAcc({ status: ShopStatus.Dormant }) }), T0 + 1)).toEqual([]);
  });

  it("confirms an accepted claim; escalates a rejected one up to the dispute deadline", () => {
    const claimed = warrantyAcc({ status: WarrantyStatus.Claimed, claimCount: 1 });
    const accepted = view({ warranty: claimed, claim: claimAcc({ status: ClaimStatus.Accepted, repairDeadline: T0 + 200 }) });
    expect(holderActions(accepted, T0 + 100)).toEqual(["confirmResolved"]);
    expect(holderActions(accepted, T0 + 201)).toEqual(["confirmResolved", "escalate"]);
    expect(holderActions(accepted, T0 + 261)).toEqual(["confirmResolved"]);
    const rejected = view({ warranty: claimed, claim: claimAcc({ status: ClaimStatus.Rejected, disputeDeadline: T0 + 300 }) });
    expect(holderActions(rejected, T0 + 300)).toEqual(["escalate"]);
    expect(holderActions(rejected, T0 + 301)).toEqual([]);
  });
});

describe("key state", () => {
  it("tells the holder, an unactivated card, a card someone else activated, and no key apart", () => {
    expect(keyState("H", "H", "C")).toBe("holder");
    expect(keyState("C", null, "C")).toBe("card-unactivated");
    expect(keyState("H", null, "C")).toBe("card-taken");
    expect(keyState("H", "X", null)).toBe("none");
  });
});
