import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@kekal/sdk";
import { demoTermsJson, failoverConnection, openSqlite, programErrorName, runtimeCluster, SendError } from "../src";

const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");

describe("demo sessions in the store", () => {
  it("stores once, reads back, ignores a replay, rejects an unknown kind", () => {
    const s = openSqlite(":memory:", MIGRATIONS);
    const row = { warranty: "W1", holder: "H1", shop: "S1", kind: "shared" as const, createdAt: 10 };
    s.putDemoSession(row);
    s.putDemoSession({ ...row, holder: "H2", createdAt: 20 });
    expect(s.getDemoSession("W1")).toEqual(row);
    expect(s.getDemoSession("W2")).toBeNull();
    expect(() => s.putDemoSession({ ...row, warranty: "W3", kind: "other" as never })).toThrow(/CHECK/);
    s.close();
  });
});

describe("warranty terms in the store", () => {
  it("keeps the first terms text for a warranty and ignores later writes", () => {
    const s = openSqlite(":memory:", MIGRATIONS);
    s.putWarrantyTerms("W1", '{"a":1}', 10);
    s.putWarrantyTerms("W1", '{"a":2}', 20);
    expect(s.getWarrantyTerms("W1")).toBe('{"a":1}');
    expect(s.getWarrantyTerms("W2")).toBeNull();
    s.close();
  });
});

describe("demo terms", () => {
  it("are canonical JSON of the config terms plus kind, reserve and term, without the doc string", () => {
    const json = demoTermsJson({ settings: { reserve: "7", termSecs: 9 } as never }, "shared");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).toMatchObject({ v: 1, kind: "shared", reserve: "7", termSecs: 9 });
    expect(parsed).not.toHaveProperty("_doc");
    expect(json).toBe(canonicalJson(parsed));
  });
});

describe("failoverConnection", () => {
  it("sends web3.js calls through the endpoint list in order", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      seen.push(url);
      if (url === "https://a.example") return new Response("busy", { status: 503 });
      const { id } = JSON.parse(init.body) as { id: unknown };
      return Response.json({ jsonrpc: "2.0", id, result: 4242 });
    }) as unknown as typeof fetch;
    const conn = failoverConnection({ urls: ["https://a.example", "https://b.example"], timeoutMs: 1000, retryStatuses: [503], fetchImpl });
    expect(await conn.getSlot()).toBe(4242);
    expect(seen).toEqual(["https://a.example", "https://b.example"]);
  });
});

describe("helpers", () => {
  it("programErrorName reads the Anchor error from the message or the logs", () => {
    expect(programErrorName(new Error("x Error Code: ClaimCooldown. Error Number: 6015"))).toBe("ClaimCooldown");
    expect(programErrorName(new SendError("simulation failed", ["Program log: AnchorError ... Error Code: NotHolder."]))).toBe("NotHolder");
    expect(programErrorName(new Error("fetch failed"))).toBeNull();
  });
  it("runtimeCluster carries the cluster demo settings", () => {
    const c = runtimeCluster({ KEKAL_CLUSTER: "localnet" });
    expect(c.demo.sharedShop.role).toBeTypeOf("string");
    expect(BigInt(c.demo.reserve)).toBeGreaterThan(0n);
  });
});
