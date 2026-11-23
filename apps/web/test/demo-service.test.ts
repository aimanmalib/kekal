import { DemoError, openSqlite, type DataStore, type Issued } from "@kekal/server";
import { Keypair, PublicKey } from "@solana/web3.js";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { arbiterAction, sellerAction, startDyingShop, startSession, type DemoDeps, type DemoLimits, type DemoOps } from "../src/lib/demo/service";

const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");
const LIMITS: DemoLimits = { sessionsPerIpPerHour: 3, sessionsPerDay: 5, dyingShopsPerIpPerHour: 2, dyingShopsPerDay: 3, actionsPerIpPerHour: 4 };
const stores: DataStore[] = [];
afterEach(() => {
  while (stores.length) stores.pop()!.close();
});

function setup(over: Partial<DemoOps> = {}) {
  const store = openSqlite(":memory:", MIGRATIONS);
  stores.push(store);
  const calls: string[] = [];
  const issued = (): Issued => ({ shop: Keypair.generate().publicKey, warranty: Keypair.generate().publicKey, signatures: ["s1"] });
  const ops: DemoOps = {
    issue: async () => (calls.push("issue"), issued()),
    dyingShop: async () => (calls.push("dying"), { ...issued(), signatures: ["s1", "s2"] }),
    respond: async (_w, accept) => (calls.push(`respond:${accept}`), "r1"),
    resolve: async (_w, buyerWins) => (calls.push(`resolve:${buyerWins}`), "a1"),
    ...over,
  };
  const deps: DemoDeps = { store, ops, limits: LIMITS, explorer: (s) => `https://x/tx/${s}`, now: 1_000_000 };
  return { deps, calls, store };
}
const holder = () => Keypair.generate().publicKey.toBase58();

describe("demo session", () => {
  it("issues to the holder, records the session, returns explorer links", async () => {
    const { deps, store } = setup();
    const h = holder();
    const r = await startSession({ holder: h }, "1.1.1.1", deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toMatchObject({ holder: h, signatures: [{ signature: "s1", explorer: "https://x/tx/s1" }] });
    expect(store.getDemoSession(r.body.warranty as string)).toMatchObject({ holder: h, kind: "shared", createdAt: 1_000_000 });
  });

  it("rejects a missing, malformed or off-curve holder before touching the chain", async () => {
    const { deps, calls } = setup();
    const offCurve = PublicKey.findProgramAddressSync([Buffer.from("x")], Keypair.generate().publicKey)[0].toBase58();
    for (const body of [null, {}, { holder: 5 }, { holder: "not-a-key" }, { holder: offCurve }]) {
      expect(await startSession(body, "1.1.1.1", deps)).toMatchObject({ ok: false, status: 400, error: "bad_holder" });
    }
    expect(calls).toEqual([]);
  });

  it("allows 3 per IP per hour, then the global day cap", async () => {
    const { deps, calls } = setup();
    for (let i = 0; i < 3; i++) expect((await startSession({ holder: holder() }, "1.1.1.1", deps)).ok).toBe(true);
    expect(await startSession({ holder: holder() }, "1.1.1.1", deps)).toMatchObject({ status: 429, error: "rate_ip" });
    expect((await startSession({ holder: holder() }, "2.2.2.2", deps)).ok).toBe(true);
    // day count is now 5 (the refused call counted too), so the next IP is over the global cap
    expect(await startSession({ holder: holder() }, "3.3.3.3", deps)).toMatchObject({ status: 429, error: "rate_global" });
    expect(calls.filter((c) => c === "issue")).toHaveLength(4);
    // a new hour resets the per-IP window
    expect((await startSession({ holder: holder() }, "1.1.1.1", { ...deps, now: deps.now + 3600, limits: { ...LIMITS, sessionsPerDay: 99 } })).ok).toBe(true);
  });

  it("maps a missing demo shop to 503 and a send failure to 502", async () => {
    let { deps } = setup({ issue: async () => Promise.reject(new DemoError("demo_shop_missing")) });
    expect(await startSession({ holder: holder() }, "1.1.1.1", deps)).toMatchObject({ status: 503, error: "demo_shop_missing" });
    ({ deps } = setup({ issue: async () => Promise.reject(new Error("blockhash not found")) }));
    expect(await startSession({ holder: holder() }, "1.1.1.1", deps)).toMatchObject({ status: 502, error: "send_failed", detail: "blockhash not found" });
  });
});

describe("dying shop", () => {
  it("has its own limits (per IP and per day)", async () => {
    const { deps, store } = setup();
    const ok = await startDyingShop({ holder: holder() }, "1.1.1.1", deps);
    expect(ok.ok && store.getDemoSession(ok.body.warranty as string)?.kind).toBe("dying");
    expect((await startDyingShop({ holder: holder() }, "1.1.1.1", deps)).ok).toBe(true);
    expect(await startDyingShop({ holder: holder() }, "1.1.1.1", deps)).toMatchObject({ status: 429, error: "rate_ip" });
    expect(await startDyingShop({ holder: holder() }, "2.2.2.2", deps)).toMatchObject({ status: 429, error: "rate_global" });
    // the shared-session quota is untouched
    expect((await startSession({ holder: holder() }, "1.1.1.1", deps)).ok).toBe(true);
  });
});

describe("seller and arbiter actions", () => {
  async function session(deps: DemoDeps, kind: "shared" | "dying" = "shared") {
    const r = kind === "shared" ? await startSession({ holder: holder() }, "9.9.9.9", deps) : await startDyingShop({ holder: holder() }, "9.9.9.9", deps);
    if (!r.ok) throw new Error("setup");
    return r.body.warranty as string;
  }

  it("act only on warranties a demo session issued", async () => {
    const { deps, calls } = setup();
    const stranger = Keypair.generate().publicKey.toBase58();
    expect(await sellerAction({ warranty: stranger, accept: true }, "1.1.1.1", deps)).toMatchObject({ status: 404, error: "not_a_demo_warranty" });
    expect(await arbiterAction({ warranty: stranger, buyerWins: true }, "1.1.1.1", deps)).toMatchObject({ status: 404 });
    const w = await session(deps);
    expect(await sellerAction({ warranty: w, accept: false }, "1.1.1.1", deps)).toMatchObject({ ok: true, body: { signature: "r1", explorer: "https://x/tx/r1" } });
    expect(await arbiterAction({ warranty: w, buyerWins: true }, "1.1.1.1", deps)).toMatchObject({ ok: true });
    expect(calls.slice(-2)).toEqual(["respond:false", "resolve:true"]);
  });

  it("the shop toggle is refused on a dying-shop warranty (nobody holds that shop's key)", async () => {
    const { deps } = setup();
    const w = await session(deps, "dying");
    expect(await sellerAction({ warranty: w, accept: true }, "1.1.1.1", deps)).toMatchObject({ status: 404 });
  });

  it("needs a boolean flag, counts actions per IP, and maps claim-state conflicts to 409", async () => {
    const { deps } = setup({ respond: async () => Promise.reject(new DemoError("claim_not_pending")) });
    const w = await session(deps);
    expect(await sellerAction({ warranty: w, accept: "yes" }, "1.1.1.1", deps)).toMatchObject({ status: 400, error: "bad_request" });
    expect(await sellerAction({ warranty: w, accept: true }, "1.1.1.1", deps)).toMatchObject({ status: 409, error: "claim_not_pending" });
    for (let i = 0; i < 3; i++) await arbiterAction({ warranty: w, buyerWins: true }, "1.1.1.1", deps);
    expect(await arbiterAction({ warranty: w, buyerWins: true }, "1.1.1.1", deps)).toMatchObject({ status: 429, error: "rate_ip" });
  });
});
