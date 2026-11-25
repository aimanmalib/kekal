import { describe, expect, it } from "vitest";
import { canonicalJson } from "@kekal/sdk";
import { demoTermsJson, failoverConnection, programErrorName, runtimeCluster, SendError } from "../src";

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
