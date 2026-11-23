import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaimStatus, ShopStatus, statusKey, WarrantyStatus } from "@kekal/sdk";
import { clusterConfig, explorerUrl, loadAppConfig, parseArgs, REPO_ROOT } from "../lib/config";

const app = loadAppConfig();
const locale = (lang: string) =>
  JSON.parse(readFileSync(join(REPO_ROOT, `locales/${lang}.json`), "utf8")) as Record<string, string>;

describe("config/app.json", () => {
  for (const name of Object.keys(app.clusters)) {
    const c = clusterConfig(name, app);
    const l = c.limits;

    it(`${name}: limits are ordered like the program requires`, () => {
      for (const [min, max] of [
        [l.minResponseSecs, l.maxResponseSecs],
        [l.minRepairSecs, l.maxRepairSecs],
        [l.minDisputeSecs, l.maxDisputeSecs],
        [l.minHeartbeatSecs, l.maxHeartbeatSecs],
        [l.minTermSecs, l.maxTermSecs],
      ] as const) {
        expect(min).toBeGreaterThan(0);
        expect(min).toBeLessThanOrEqual(max);
      }
      expect(l.disputeTimeoutSecs).toBeGreaterThan(0);
      expect(l.maxClaimsPerWarranty).toBeGreaterThan(0);
    });

    it(`${name}: lifecycle shop windows and terms fit the limits`, () => {
      for (const w of [c.lifecycle.shopWindows, c.lifecycle.dyingShopWindows]) {
        expect(w.responseSecs).toBeGreaterThanOrEqual(l.minResponseSecs);
        expect(w.repairSecs).toBeGreaterThanOrEqual(l.minRepairSecs);
        expect(w.disputeSecs).toBeGreaterThanOrEqual(l.minDisputeSecs);
        expect(w.heartbeatSecs).toBeGreaterThanOrEqual(l.minHeartbeatSecs);
        expect(w.graceSecs).toBeLessThanOrEqual(l.maxGraceSecs);
      }
      for (const t of [c.lifecycle.termSecs, c.lifecycle.shortTermSecs]) {
        expect(t).toBeGreaterThanOrEqual(l.minTermSecs);
        expect(t).toBeLessThanOrEqual(l.maxTermSecs);
      }
      expect(BigInt(c.lifecycle.reserve) * 4n).toBeLessThanOrEqual(BigInt(c.lifecycle.depositAmount));
    });

    it(`${name}: demo shop windows fit the limits; the shared shop matches the lifecycle shop (same owner key)`, () => {
      const d = c.demo;
      const fits = (w: typeof d.sharedShop.windows) => {
        expect(w.responseSecs).toBeGreaterThanOrEqual(l.minResponseSecs);
        expect(w.responseSecs).toBeLessThanOrEqual(l.maxResponseSecs);
        expect(w.repairSecs).toBeGreaterThanOrEqual(l.minRepairSecs);
        expect(w.repairSecs).toBeLessThanOrEqual(l.maxRepairSecs);
        expect(w.disputeSecs).toBeGreaterThanOrEqual(l.minDisputeSecs);
        expect(w.disputeSecs).toBeLessThanOrEqual(l.maxDisputeSecs);
        expect(w.heartbeatSecs).toBeGreaterThanOrEqual(l.minHeartbeatSecs);
        expect(w.heartbeatSecs).toBeLessThanOrEqual(l.maxHeartbeatSecs);
        expect(w.graceSecs).toBeLessThanOrEqual(l.maxGraceSecs);
      };
      [d.sharedShop.windows, d.dyingShop.windows, d.showcaseShop.windows].forEach(fits);
      expect(d.termSecs).toBeGreaterThanOrEqual(l.minTermSecs);
      expect(d.termSecs).toBeLessThanOrEqual(l.maxTermSecs);
      if (d.sharedShop.role === "demo-seller") expect(c.lifecycle.shopWindows).toEqual(d.sharedShop.windows);
      // the float must cover at least one day of dying shops
      expect(BigInt(d.sharedShop.sellerFloat)).toBeGreaterThanOrEqual(BigInt(d.reserve) * BigInt(app.web.demo.dyingShopsPerDay));
      expect(BigInt(d.reserve) * BigInt(d.showcaseShop.warranties)).toBeLessThanOrEqual(BigInt(d.showcaseShop.depositAmount));
    });

    it(`${name}: explorer template has a signature slot`, () => {
      expect(explorerUrl(c, "SIG")).toContain("SIG");
    });
  }

  it("rejects an unknown cluster", () => {
    expect(() => clusterConfig("mainnet", app)).toThrow(/unknown cluster/);
  });
});

describe("locales", () => {
  const en = locale("en");
  const ms = locale("ms");

  it("en and ms have the same keys and no empty text", () => {
    expect(Object.keys(ms).sort()).toEqual(Object.keys(en).sort());
    for (const v of [...Object.values(en), ...Object.values(ms)]) expect(v.trim()).not.toBe("");
  });

  it("every on-chain status has text", () => {
    const keys = [
      ...Object.values(ShopStatus).map(statusKey.shop),
      ...Object.values(WarrantyStatus).map(statusKey.warranty),
      ...Object.values(ClaimStatus).map(statusKey.claim),
    ];
    for (const k of keys) expect(en[k], k).toBeTruthy();
  });
});

describe("parseArgs", () => {
  it("reads flags and values", () => {
    expect(parseArgs(["--cluster", "localnet", "--dry"])).toEqual({ cluster: "localnet", dry: "true" });
    expect(() => parseArgs(["loose"])).toThrow();
  });
});
