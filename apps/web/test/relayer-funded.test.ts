import { describe, expect, it, vi } from "vitest";
import { relayerFundedCheck } from "../src/lib/relay/funded";

describe("relayerFundedCheck", () => {
  const make = (over: Partial<Parameters<typeof relayerFundedCheck>[0]> = {}) => {
    let t = 1_000;
    const getBalance = vi.fn(async () => 600);
    const check = relayerFundedCheck({ address: () => "R", getBalance, minLamports: 500, cacheMs: 60_000, now: () => t, ...over });
    return { check, getBalance, advance: (ms: number) => (t += ms) };
  };
  it("true at or above the minimum, false below", async () => {
    expect(await make().check()).toBe(true);
    expect(await make({ getBalance: async () => 500 }).check()).toBe(true);
    expect(await make({ getBalance: async () => 499 }).check()).toBe(false);
  });
  it("null when the relayer key is not loaded, without an RPC read", async () => {
    const { check, getBalance } = make({ address: () => null });
    expect(await check()).toBeNull();
    expect(getBalance).not.toHaveBeenCalled();
  });
  it("null when the RPC fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await make({ getBalance: async () => Promise.reject(new Error("all endpoints down")) }).check()).toBeNull();
    err.mockRestore();
  });
  it("reads the balance once per cache window", async () => {
    const { check, getBalance, advance } = make();
    await check();
    advance(59_999);
    await check();
    expect(getBalance).toHaveBeenCalledTimes(1);
    advance(1);
    await check();
    expect(getBalance).toHaveBeenCalledTimes(2);
  });
});
