import { describe, expect, it, vi } from "vitest";
import { fundsCheck, type FundsDeps } from "../src/lib/relay/funded";

describe("fundsCheck", () => {
  const make = (over: Partial<FundsDeps> = {}) => {
    let t = 1_000;
    const balances: Record<string, number> = { S: 3_000, R: 600 };
    const getBalance = vi.fn(async (a: string) => balances[a]!);
    const check = fundsCheck({
      addresses: () => ({ demoSeller: "S", relayer: "R" }),
      getBalance,
      runCostLamports: { demoSeller: 1_000, relayer: 250 },
      relayerMinLamports: 500,
      cacheMs: 60_000,
      now: () => t,
      ...over,
    });
    return { check, getBalance, advance: (ms: number) => (t += ms) };
  };
  it("relayer funded at or above the minimum, not below", async () => {
    expect((await make().check()).relayerFunded).toBe(true);
    expect((await make({ getBalance: async () => 500 }).check()).relayerFunded).toBe(true);
    expect((await make({ getBalance: async () => 499 }).check()).relayerFunded).toBe(false);
  });
  it("runs left = whole runs each key can still pay for; balances in SOL", async () => {
    const f = await make().check();
    expect(f.runsLeft).toEqual({ demoSeller: 3, relayer: 2 });
    expect(f.balancesSol).toEqual({ demoSeller: 0.000003, relayer: 0.000001 });
    expect((await make({ getBalance: async () => 1_500_000_000 }).check()).balancesSol.demoSeller).toBe(1.5);
  });
  it("null for a key that is not loaded, without an RPC read for it", async () => {
    const { check, getBalance } = make({ addresses: () => ({ demoSeller: null, relayer: "R" }) });
    const f = await check();
    expect(f.runsLeft).toEqual({ demoSeller: null, relayer: 2 });
    expect(f.balancesSol.demoSeller).toBeNull();
    expect(getBalance).toHaveBeenCalledTimes(1);
  });
  it("null everywhere when the RPC fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = await make({ getBalance: async () => Promise.reject(new Error("all endpoints down")) }).check();
    expect(f).toEqual({ relayerFunded: null, runsLeft: { demoSeller: null, relayer: null }, balancesSol: { demoSeller: null, relayer: null } });
    err.mockRestore();
  });
  it("reads the balances once per cache window", async () => {
    const { check, getBalance, advance } = make();
    await check();
    advance(59_999);
    await check();
    expect(getBalance).toHaveBeenCalledTimes(2);
    advance(1);
    await check();
    expect(getBalance).toHaveBeenCalledTimes(4);
  });
});
