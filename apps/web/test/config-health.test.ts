import { describe, expect, it } from "vitest";
import app from "../../../config/app.json";
import idl from "@kekal/sdk/idl";
import { parseUrlList, runtimeCluster, sampleReserve } from "../src/lib/config";
import { buildHealth, KEEPER_LAST_RUN_KEY } from "../src/lib/health";

describe("runtimeCluster", () => {
  it("defaults to the config cluster and its RPC list", () => {
    const c = runtimeCluster({});
    expect(c.name).toBe(app.defaultCluster);
    expect(c.rpcUrls.length).toBeGreaterThan(0);
    expect(c.programId).toBe(idl.address);
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
  const store = (v: string | null) => ({ backend: "sqlite", getConfig: (k: string) => (k === KEEPER_LAST_RUN_KEY ? v : null) });
  it("reports keeper_last_run when present", () => {
    expect(buildHealth(cluster, store("1700000000"))).toMatchObject({
      ok: true,
      cluster: "localnet",
      dataBackend: "sqlite",
      keeperLastRun: 1700000000,
      relayerFunded: null,
    });
  });
  it("null keeper run when never written or garbage", () => {
    expect(buildHealth(cluster, store(null)).keeperLastRun).toBeNull();
    expect(buildHealth(cluster, store("soon")).keeperLastRun).toBeNull();
  });
  it("not ok when the store failed", () => {
    expect(buildHealth(cluster, new Error("x"))).toMatchObject({ ok: false, dataBackend: null });
  });
});
