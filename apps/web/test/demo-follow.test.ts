// /demo after a step: a failed read keeps the scene "checking" (never the old claim form) and backs off as configured.
import { describe, expect, it } from "vitest";
import { readView, recheckDelay, retryAfterMs, scenePanel } from "../src/lib/demo/follow";
import { webConfig } from "../src/lib/web-config";
import { view } from "./warranty-fixtures";

const fetchAnswering = (res: Response | Error) =>
  (async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;

describe("readView", () => {
  it("returns the view on 200", async () => {
    const v = view();
    const r = await readView("x", fetchAnswering(Response.json(JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? String(x) : x))))));
    expect(r.ok && r.view.pda).toBe(v.pda);
  });

  it("carries the server's Retry-After on 503, and fails softly on a network error", async () => {
    const busy = new Response('{"error":"busy"}', { status: 503, headers: { "retry-after": "3" } });
    expect(await readView("x", fetchAnswering(busy))).toEqual({ ok: false, retryAfterMs: 3000 });
    expect(await readView("x", fetchAnswering(new Response("", { status: 502 })))).toEqual({ ok: false, retryAfterMs: null });
    expect(await readView("x", fetchAnswering(new Error("offline")))).toEqual({ ok: false, retryAfterMs: null });
  });

  it("ignores a Retry-After it cannot read", () => {
    expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("0")).toBe(0);
  });
});

describe("recheckDelay", () => {
  const { recheckMs, pollMs } = webConfig.demoPage;
  it("follows the configured back-off, then the poll interval for as long as the scene is open", () => {
    const waits = Array.from({ length: recheckMs.length + 3 }, (_, i) => recheckDelay(i, null, recheckMs, pollMs));
    expect(waits.slice(0, recheckMs.length)).toEqual(recheckMs);
    expect(waits.slice(recheckMs.length)).toEqual([pollMs, pollMs, pollMs]);
  });

  it("waits at least as long as the server asked", () => {
    expect(recheckDelay(0, 60_000, [1000], 5000)).toBe(60_000);
    expect(recheckDelay(0, 10, [1000], 5000)).toBe(1000);
  });
});

describe("scenePanel", () => {
  it("shows 'checking' instead of the claim form or the settle button while a read is pending", () => {
    for (const phase of ["claim", "wait", "due", "paid", null]) expect(scenePanel(phase, true)).toBe("checking");
    expect(scenePanel("claim", false)).toBe("claim");
    expect(scenePanel("idle", false)).toBeNull();
  });
});
