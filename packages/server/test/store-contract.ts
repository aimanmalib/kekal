// One behaviour suite for every DataStore adapter (store.test.ts runs it on SQLite and, when a database is given, Postgres).
import { describe, expect, it } from "vitest";
import type { DataStore, SessionNonce } from "../src";

export interface StoreHarness {
  /** A store on an empty database (all migrations applied). */
  fresh(): Promise<DataStore>;
  /** A second store on the database the last fresh() made, as after a restart. */
  reopen(): Promise<DataStore>;
}

const nonce = (n: string, expiresAt: number): SessionNonce => ({ nonce: n, pubkey: `pk-${n}`, message: `sign ${n}`, expiresAt });

export function storeContract(name: string, h: StoreHarness): void {
  describe(`${name} store`, () => {
    it("keeps config values, overwrites them and still has them after a restart", async () => {
      const s = await h.fresh();
      expect(await s.getConfig("keeper_last_run")).toBeNull();
      await s.setConfig("keeper_last_run", "123", 100);
      await s.setConfig("keeper_last_run", "456", 101);
      await s.close();
      const again = await h.reopen();
      expect(await again.getConfig("keeper_last_run")).toBe("456");
      await again.close();
    });

    it("counts hits per fixed window and per key", async () => {
      const s = await h.fresh();
      expect(await s.hit("ip:1", 3600, 7200)).toBe(1);
      expect(await s.hit("ip:1", 3600, 10799)).toBe(2);
      expect(await s.hit("ip:2", 3600, 10799)).toBe(1);
      expect(await s.hit("ip:1", 3600, 10800)).toBe(1);
      await s.close();
    });

    it("gives parallel hits on one key distinct counts (no lost updates)", async () => {
      const s = await h.fresh();
      const counts = await Promise.all(Array.from({ length: 20 }, () => s.hit("burst", 60, 600)));
      expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      await s.close();
    });

    it("hands out a sign-in challenge once, never after it expires, and drops expired ones on the next write", async () => {
      const s = await h.fresh();
      await s.putNonce(nonce("a", 200), 100);
      await s.putNonce(nonce("b", 150), 100);
      expect(await s.takeNonce("a", 120)).toEqual(nonce("a", 200));
      expect(await s.takeNonce("a", 121)).toBeNull();
      expect(await s.takeNonce("b", 151)).toBeNull();
      await s.putNonce(nonce("c", 400), 160);
      expect(await s.takeNonce("b", 140)).toBeNull();
      expect(await s.takeNonce("missing", 100)).toBeNull();
      await s.close();
    });

    it("stores a demo warranty once, ignores a replay, rejects an unknown kind", async () => {
      const s = await h.fresh();
      const row = { warranty: "W1", holder: "H1", shop: "S1", kind: "shared" as const, createdAt: 10 };
      await s.putDemoSession(row);
      await s.putDemoSession({ ...row, holder: "H2", createdAt: 20 });
      expect(await s.getDemoSession("W1")).toEqual(row);
      expect(await s.getDemoSession("W2")).toBeNull();
      await expect(s.putDemoSession({ ...row, warranty: "W3", kind: "other" as never })).rejects.toThrow(/check/i);
      await s.close();
    });

    it("keeps the first terms text for a warranty and ignores later writes", async () => {
      const s = await h.fresh();
      await s.putWarrantyTerms("W1", '{"a":1}', 10);
      await s.putWarrantyTerms("W1", '{"a":2}', 20);
      expect(await s.getWarrantyTerms("W1")).toBe('{"a":1}');
      expect(await s.getWarrantyTerms("W2")).toBeNull();
      await s.close();
    });
  });
}
