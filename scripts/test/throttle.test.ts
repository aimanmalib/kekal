import { describe, expect, it } from "vitest";
import { throttledFetch } from "../lib/throttle";

const answers = (statuses: number[]) => {
  const calls: number[] = [];
  const fetchImpl = (async () => {
    calls.push(Date.now());
    return new Response("{}", { status: statuses[calls.length - 1] ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};

describe("throttledFetch", () => {
  it("retries a 429 with a doubling delay and returns the first other answer", async () => {
    const { calls, fetchImpl } = answers([429, 429, 200]);
    const waits: number[] = [];
    const f = throttledFetch({ minGapMs: 0, retryMs: 100, maxRetries: 5, fetchImpl, sleep: async (ms) => void waits.push(ms) });
    expect((await f("http://rpc")).status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([100, 200]);
  });
  it("gives the 429 back once the retries are spent", async () => {
    const { calls, fetchImpl } = answers([429, 429, 429]);
    const f = throttledFetch({ minGapMs: 0, retryMs: 1, maxRetries: 1, fetchImpl, sleep: async () => {} });
    expect((await f("http://rpc")).status).toBe(429);
    expect(calls).toHaveLength(2);
  });
  it("spaces requests started together by minGapMs each", async () => {
    const { calls, fetchImpl } = answers([]);
    const waits: number[] = [];
    const f = throttledFetch({ minGapMs: 40, retryMs: 1, maxRetries: 0, fetchImpl, sleep: async (ms) => void waits.push(ms) });
    await Promise.all([f("http://rpc"), f("http://rpc"), f("http://rpc")]);
    expect(calls).toHaveLength(3);
    // The first goes at once; the next two wait one and two gaps (less any milliseconds that passed meanwhile).
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThan(30);
    expect(waits[0]).toBeLessThanOrEqual(40);
    expect(waits[1]).toBeGreaterThan(70);
    expect(waits[1]).toBeLessThanOrEqual(80);
  });
});
