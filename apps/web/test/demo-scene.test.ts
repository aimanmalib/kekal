// /demo scene logic: what the visitor sees next, and which transactions are listed with which sentence.
import { ClaimStatus, ShopStatus, WarrantyStatus } from "@kekal/sdk";
import { describe, expect, it } from "vitest";
import { readRemembered, scenePhase, sceneSteps } from "../src/lib/demo/scene";
import { translator } from "../src/lib/i18n";
import { withShopSilence } from "../src/lib/warranty/read";
import { T0, claimAcc, entry, keys, shopAcc, view, warrantyAcc } from "./warranty-fixtures";

describe("scenePhase", () => {
  it("asks for a claim on a fresh card in the silent-shop scene, but not in the closing-shop scene", () => {
    expect(scenePhase("silent", view(), T0 + 5)).toEqual({ kind: "claim" });
    expect(scenePhase("closed", view(), T0 + 5).kind).toBe("wait");
  });

  it("counts down to the unanswered payout, then offers it once due on the chain clock", () => {
    const v = view({
      warranty: warrantyAcc({ status: WarrantyStatus.Claimed, claimCount: 1, openClaim: 1 }),
      claim: claimAcc({ filedAt: T0 + 10 }),
    });
    const due = v.next!.dueAt;
    expect(scenePhase("silent", v, due - 1)).toEqual({ kind: "wait", action: "settleUnanswered", dueAt: due });
    expect(scenePhase("silent", v, due)).toEqual({ kind: "due", action: "settleUnanswered" });
  });

  it("marks a shop past its check-in silent first, then pays the orphaned card", () => {
    const silentSoon = view({ shop: shopAcc({ lastSeen: T0, heartbeatSecs: 60, graceSecs: 0 }) });
    expect(scenePhase("closed", silentSoon, T0 + 30)).toMatchObject({ kind: "wait", action: "declareDormant" });
    expect(scenePhase("closed", silentSoon, T0 + 61)).toEqual({ kind: "due", action: "declareDormant" });
    const dormant = view({ shop: shopAcc({ status: ShopStatus.Dormant, dormantAt: T0 + 61, graceSecs: 0 }) });
    expect(scenePhase("closed", dormant, T0 + 62)).toEqual({ kind: "due", action: "claimOrphan" });
  });

  it("ends the scene once the reserve is paid, whoever sent the payout", () => {
    const paid = view({
      warranty: warrantyAcc({ status: WarrantyStatus.PaidOut }),
      timeline: [entry({ events: ["ReservePaid", "ClaimStatusChanged"], paid: { amount: "25000000", claimStatus: ClaimStatus.PaidTimeout } })],
    });
    expect(scenePhase("silent", paid, T0)).toEqual({ kind: "paid", amount: "25000000", statusKey: "status.claim.paidTimeout" });
  });

  it("does not offer the end-of-warranty release as a demo step", () => {
    const v = view({ shop: shopAcc({ heartbeatSecs: 10_000_000_000 }), warranty: warrantyAcc({ expiresAt: T0 + 100 }) });
    expect(scenePhase("closed", v, T0 + 200)).toEqual({ kind: "idle" });
  });
});

describe("sceneSteps", () => {
  it("lists transactions oldest first with the most telling event, skipping failed and unlabelled ones", () => {
    const v = view({
      timeline: [
        entry({ signature: "s4", events: ["ReservePaid", "ClaimStatusChanged"] }),
        entry({ signature: "s3", events: [], failed: true }),
        entry({ signature: "s2", events: ["ClaimFiled"] }),
        entry({ signature: "s1b", events: ["HeartbeatSent"] }),
        entry({ signature: "s1", events: ["HeartbeatSent", "WarrantyIssued"] }),
      ],
    });
    const steps = sceneSteps(v);
    expect(steps.map((s) => [s.signature, s.event])).toEqual([
      ["s1", "WarrantyIssued"],
      ["s2", "ClaimFiled"],
      ["s4", "ReservePaid"],
    ]);
    for (const lang of ["en", "ms"] as const) {
      const t = translator(lang);
      for (const s of steps) expect([t(s.label), t(s.why)].every((x) => typeof x === "string" && x.length > 0)).toBe(true);
    }
  });
});

describe("withShopSilence", () => {
  it("adds the shop's 'marked silent' transaction to the warranty history in time order, once", () => {
    const own = [entry({ signature: "paid", blockTime: T0 + 90, events: ["ReservePaid"] }), entry({ signature: "issued", blockTime: T0, events: ["WarrantyIssued"] })];
    const shop = [
      entry({ signature: "paid", blockTime: T0 + 90, events: ["ReservePaid"] }),
      entry({ signature: "silent", blockTime: T0 + 80, events: ["ShopDeclaredDormant"] }),
      entry({ signature: "beat", blockTime: T0 + 1, events: ["HeartbeatSent"] }),
      entry({ signature: "failed", blockTime: T0 + 70, events: ["ShopDeclaredDormant"], failed: true }),
    ];
    const merged = withShopSilence(own, shop);
    expect(merged.map((e) => e.signature)).toEqual(["paid", "silent", "issued"]);
    expect(sceneSteps(view({ timeline: merged })).map((s) => s.event)).toEqual(["WarrantyIssued", "ShopDeclaredDormant", "ReservePaid"]);
    expect(withShopSilence(own, [])).toBe(own);
  });
});

describe("readRemembered", () => {
  it("keeps only well-formed warranty addresses per scene", () => {
    const pda = keys.pda.toBase58();
    expect(readRemembered(JSON.stringify({ silent: pda, closed: "not an address", other: pda }))).toEqual({ silent: pda });
    expect(readRemembered("{oops")).toEqual({});
    expect(readRemembered(null)).toEqual({});
  });
});
