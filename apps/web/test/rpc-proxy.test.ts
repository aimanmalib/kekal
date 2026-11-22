import { describe, expect, it } from "vitest";
import { checkRequest, forwardWithFailover, type RpcPolicy } from "../src/lib/rpc-proxy";

const PROGRAM = "Prog111111111111111111111111111111111111111";
const policy: RpcPolicy = {
  allowedMethods: ["getAccountInfo", "getProgramAccounts", "getLatestBlockhash"],
  programScopedMethods: ["getProgramAccounts"],
  programId: PROGRAM,
  maxBodyBytes: 512,
  maxBatch: 2,
};
const call = (method: string, params?: unknown[], id: unknown = 1) => ({ jsonrpc: "2.0", id, method, params });
const check = (body: unknown) => checkRequest(typeof body === "string" ? body : JSON.stringify(body), policy);

describe("checkRequest", () => {
  it("accepts an allowed call", () => {
    const r = check(call("getAccountInfo", ["abc"]));
    expect(r).toMatchObject({ ok: true, batch: false });
  });
  it("accepts a batch within the limit", () => {
    expect(check([call("getLatestBlockhash"), call("getAccountInfo", ["x"], 2)])).toMatchObject({ ok: true, batch: true });
  });
  it("rejects sendTransaction and other methods off the list with 403", () => {
    expect(check(call("sendTransaction", ["AAAA"]))).toMatchObject({ ok: false, status: 403 });
    expect(check(call("requestAirdrop", ["x", 1]))).toMatchObject({ ok: false, status: 403 });
  });
  it("one bad call rejects the whole batch", () => {
    expect(check([call("getLatestBlockhash"), call("sendTransaction")])).toMatchObject({ ok: false, status: 403 });
  });
  it("limits getProgramAccounts to the Kekal program", () => {
    expect(check(call("getProgramAccounts", [PROGRAM]))).toMatchObject({ ok: true });
    expect(check(call("getProgramAccounts", ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"]))).toMatchObject({ ok: false, status: 403 });
    expect(check(call("getProgramAccounts"))).toMatchObject({ ok: false, status: 403 });
  });
  it("rejects malformed bodies", () => {
    expect(check("{not json")).toMatchObject({ ok: false, status: 400 });
    expect(check([])).toMatchObject({ ok: false, status: 400 });
    expect(check({ jsonrpc: "1.0", id: 1, method: "getSlot" })).toMatchObject({ ok: false, status: 400 });
    expect(check(call("getAccountInfo", "x" as unknown as unknown[]))).toMatchObject({ ok: false, status: 400 });
    expect(check(call("getAccountInfo", [], { nested: true }))).toMatchObject({ ok: false, status: 400 });
  });
  it("rejects oversized bodies and batches", () => {
    expect(check(call("getAccountInfo", ["x".repeat(600)]))).toMatchObject({ ok: false, status: 413 });
    expect(check([call("getSlot"), call("getSlot"), call("getSlot")].map(() => call("getLatestBlockhash")))).toMatchObject({
      ok: false,
      status: 400,
    });
  });
  it("drops unknown top-level fields before forwarding", () => {
    const r = check({ ...call("getAccountInfo", ["x"]), extra: "y" });
    expect(r.ok && r.calls[0]).toEqual({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: ["x"] });
  });
});

type Step = { status: number; body: string } | "throw";
function fakeFetch(plan: Record<string, Step>) {
  const seen: string[] = [];
  const impl = (async (url: string) => {
    seen.push(url);
    const step = plan[url];
    if (!step || step === "throw") throw new TypeError("network down");
    return new Response(step.body, { status: step.status });
  }) as unknown as typeof fetch;
  return { impl, seen };
}
const opts = (urls: string[], impl: typeof fetch) => ({ urls, timeoutMs: 1000, retryStatuses: [429, 503], fetchImpl: impl });

describe("forwardWithFailover", () => {
  it("uses the first endpoint when it answers", async () => {
    const f = fakeFetch({ a: { status: 200, body: "A" }, b: { status: 200, body: "B" } });
    const r = await forwardWithFailover("{}", opts(["a", "b"], f.impl));
    expect(r).toMatchObject({ status: 200, body: "A", url: "a" });
    expect(f.seen).toEqual(["a"]);
  });
  it("moves on after a network error", async () => {
    const f = fakeFetch({ a: "throw", b: { status: 200, body: "B" } });
    expect(await forwardWithFailover("{}", opts(["a", "b"], f.impl))).toMatchObject({ body: "B" });
  });
  it("moves on after a retryable status", async () => {
    const f = fakeFetch({ a: { status: 429, body: "slow" }, b: { status: 200, body: "B" } });
    expect(await forwardWithFailover("{}", opts(["a", "b"], f.impl))).toMatchObject({ body: "B" });
  });
  it("does not retry a non-retryable error status", async () => {
    const f = fakeFetch({ a: { status: 400, body: "bad" }, b: { status: 200, body: "B" } });
    expect(await forwardWithFailover("{}", opts(["a", "b"], f.impl))).toMatchObject({ status: 400, url: "a" });
    expect(f.seen).toEqual(["a"]);
  });
  it("returns the last retryable answer when every endpoint fails", async () => {
    const f = fakeFetch({ a: { status: 503, body: "down" }, b: "throw" });
    expect(await forwardWithFailover("{}", opts(["a", "b"], f.impl))).toMatchObject({ status: 503, url: "a" });
  });
  it("throws when nothing answered at all", async () => {
    const f = fakeFetch({});
    await expect(forwardWithFailover("{}", opts(["a", "b"], f.impl))).rejects.toThrow(/all RPC endpoints failed/);
  });
});
