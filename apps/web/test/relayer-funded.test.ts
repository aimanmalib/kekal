import { describe, expect, it, vi } from "vitest";
import { fundsCheck, type FundsDeps } from "../src/lib/relay/funded";

describe("fundsCheck", () => {
  const make = (over: Partial<FundsDeps> = {}) => {
    let t = 1_000;
    const balances: Record<string, number> = { S: 3_000, R: 600 };
    const getBalances = vi.fn(async (list: string[]) => list.map((a) => balances[a]!));
    const check = fundsCheck({
      addresses: () => ({ demoSeller: "S", relayer: "R" }),
      getBalances,
      runCostLamports: { demoSeller: 1_000, relayer: 250 },
      relayerMinLamports: 500,
      cacheMs: 60_000,
      now: () => t,
      ...over,
    });
    return { check, getBalances, advance: (ms: number) => (t += ms) };
  };
  it("relayer funded at or above the minimum, not below", async () => {
    expect((await make().check()).relayerFunded).toBe(true);
    const n = (v: number) => async (list: string[]) => list.map(() => v);
    expect((await make({ getBalances: n(500) }).check()).relayerFunded).toBe(true);
    expect((await make({ getBalances: n(499) }).check()).relayerFunded).toBe(false);
  });
  it("runs left = whole runs each key can still pay for; balances in SOL", async () => {
    const f = await make().check();
    expect(f.runsLeft).toEqual({ demoSeller: 3, relayer: 2 });
    expect(f.balancesSol).toEqual({ demoSeller: 0.000003, relayer: 0.000001 });
    expect((await make({ getBalances: async (l) => l.map(() => 1_500_000_000) }).check()).balancesSol.demoSeller).toBe(1.5);
  });
  it("null for a key that is not loaded, without an RPC read for it", async () => {
    const { check, getBalances } = make({ addresses: () => ({ demoSeller: null, relayer: "R" }) });
    const f = await check();
    expect(f.runsLeft).toEqual({ demoSeller: null, relayer: 2 });
    expect(f.balancesSol.demoSeller).toBeNull();
    expect(getBalances).toHaveBeenCalledWith(["R"]);
    const none = make({ addresses: () => ({ demoSeller: null, relayer: null }) });
    expect((await none.check()).relayerFunded).toBeNull();
    expect(none.getBalances).not.toHaveBeenCalled();
  });
  it("null everywhere when the RPC fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = await make({ getBalances: async () => Promise.reject(new Error("all endpoints down")) }).check();
    expect(f).toEqual({ relayerFunded: null, runsLeft: { demoSeller: null, relayer: null }, balancesSol: { demoSeller: null, relayer: null } });
    err.mockRestore();
  });
  it("reads both balances in one call, once per cache window", async () => {
    const { check, getBalances, advance } = make();
    await check();
    expect(getBalances).toHaveBeenCalledWith(["S", "R"]);
    advance(59_999);
    await check();
    expect(getBalances).toHaveBeenCalledTimes(1);
    advance(1);
    await check();
    expect(getBalances).toHaveBeenCalledTimes(2);
  });
});
