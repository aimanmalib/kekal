import { describe, expect, it } from "vitest";
import app from "../../../config/app.json";
import idl from "@kekal/sdk/idl";
import { parseUrlList, runtimeCluster, sampleReserve } from "../src/lib/config";
import { buildHealth, KEEPER_LAST_RUN_KEY, liveFeatures } from "../src/lib/health";

describe("runtimeCluster", () => {
  it("defaults to the config cluster and its RPC list", () => {
    const c = runtimeCluster({});
    expect(c.name).toBe(app.defaultCluster);
    expect(c.rpcUrls.length).toBeGreaterThan(0);
    expect(c.programId).toBe(idl.address);
  });
  it("devnet has RPC failover: at least two distinct HTTPS endpoints", () => {
    const urls = app.clusters.devnet.rpcUrls;
    expect(new Set(urls.map((u) => new URL(u).host)).size).toBeGreaterThanOrEqual(2);
    for (const u of urls) expect(new URL(u).protocol).toBe("https:");
  });
  it("RPC_URLS overrides the list, in order", () => {
    expect(runtimeCluster({ RPC_URLS: "https://a.example, https://b.example" }).rpcUrls).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
  it("KEKAL_CLUSTER and KEKAL_PROGRAM_ID are read", () => {
    const c = runtimeCluster({ KEKAL_CLUSTER: "localnet", KEKAL_PROGRAM_ID: "X" });
    expect(c.name).toBe("localnet");
    expect(c.programId).toBe("X");
  });
  it("unknown cluster is an error", () => {
    expect(() => runtimeCluster({ KEKAL_CLUSTER: "mainnet" })).toThrow(/unknown cluster/);
  });
  it("parseUrlList drops blanks", () => expect(parseUrlList(" a ,, b ")).toEqual(["a", "b"]));
  it("sample reserve is a two-decimal amount", () => expect(sampleReserve()).toMatch(/^\d+\.\d{2}$/));
});

describe("buildHealth", () => {
  const cluster = runtimeCluster({ KEKAL_CLUSTER: "localnet" });
  const store = (v: string | null) => ({ backend: "sqlite", getConfig: async (k: string) => (k === KEEPER_LAST_RUN_KEY ? v : null) });
  it("reports keeper_last_run when present", async () => {
    expect(await buildHealth(cluster, store("1700000000"))).toMatchObject({
      ok: true,
      cluster: "localnet",
      dataBackend: "sqlite",
      keeperLastRun: 1700000000,
      relayerFunded: null,
    });
  });
  it("passes the relayer funding check through", async () => {
    expect((await buildHealth(cluster, store(null), async () => false)).relayerFunded).toBe(false);
    expect((await buildHealth(cluster, new Error("x"), async () => true)).relayerFunded).toBe(true);
  });
  it("lists supabase as a live feature only on the Postgres backend", async () => {
    expect(liveFeatures("sqlite")).toEqual([]);
    expect(liveFeatures("supabase")).toEqual(["supabase"]);
    expect((await buildHealth(cluster, store(null))).features).toEqual([]);
  });
  it("health limits are sane", () => {
    expect(app.web.health.relayerMinSol).toBeGreaterThan(0);
    expect(app.web.health.balanceCacheSecs).toBeGreaterThanOrEqual(1);
  });
  it("null keeper run when never written or garbage", async () => {
    expect((await buildHealth(cluster, store(null))).keeperLastRun).toBeNull();
    expect((await buildHealth(cluster, store("soon"))).keeperLastRun).toBeNull();
  });
  it("not ok when the store failed", async () => {
    expect(await buildHealth(cluster, new Error("x"))).toMatchObject({ ok: false, dataBackend: null });
  });
  it("not ok when the store cannot answer (database down)", async () => {
    const down = { backend: "supabase", getConfig: async () => Promise.reject(new Error("connect ECONNREFUSED")) };
    expect(await buildHealth(cluster, down)).toMatchObject({ ok: false, dataBackend: null, error: "data store unavailable" });
  });
});
