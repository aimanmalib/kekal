// Many readers of one warranty: shared reads, two RPC calls per repeat read, and 503 + Retry-After when the RPC limits us.
import { BN, claimPda, configPda, readOnlyProgram, WarrantyStatus, type KekalProgram } from "@kekal/sdk";
import { failoverConnection, type RuntimeCluster } from "@kekal/server";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { beforeEach, describe, expect, it } from "vitest";
import { webConfig } from "../src/lib/config";
import { isRateLimited, RateLimited, SharedReads, withRateRetry } from "../src/lib/warranty/read-cache";
import { readResponse } from "../src/lib/warranty/read-response";
import { readWarranty, resetReadCaches } from "../src/lib/warranty/read";
import { claimAcc, keys, limits, shopAcc, view, warrantyAcc } from "./warranty-fixtures";

const rc = webConfig.warrantyPage.readCache;
const programId = keys.program;
const program: KekalProgram = readOnlyProgram({} as Connection, programId);
const pda = keys.pda;

// ---- account bytes from plain objects, through the program's own coder ----
type IdlType = string | { array?: [IdlType, number]; vec?: IdlType; defined?: { name: string }; option?: IdlType };
// Anchor hands the IDL over camelCased: type names ("warranty", "configLimits") and field names alike.
const idlTypes = new Map((program.idl.types ?? []).map((t) => [t.name, t] as const));

function zero(t: IdlType): unknown {
  if (typeof t === "string") return t === "u64" || t === "i64" ? new BN(0) : t === "pubkey" ? PublicKey.default : t === "bool" ? false : 0;
  if (t.array) return Array.from({ length: t.array[1] }, () => zero(t.array![0]));
  if (t.vec || t.option) return t.vec ? [] : null;
  const def = idlTypes.get(t.defined!.name) as unknown as { type: { fields: { name: string; type: IdlType }[] } };
  return Object.fromEntries(def.type.fields.map((f) => [f.name, zero(f.type)]));
}

function raw(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (!(k in base)) continue;
    const b = base[k];
    if (BN.isBN(b)) out[k] = new BN(String(v));
    else if (v instanceof Uint8Array) out[k] = Array.from(v);
    else if (b && typeof b === "object" && !Array.isArray(b) && !(b instanceof PublicKey)) out[k] = raw(b as Record<string, unknown>, v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

async function account(name: "config" | "shop" | "warranty" | "claim", over: object): Promise<AccountInfo<Buffer>> {
  const data = await program.coder.accounts.encode(name as never, raw(zero({ defined: { name } }) as Record<string, unknown>, over as Record<string, unknown>));
  return { data, owner: programId, lamports: 1, executable: false, rentEpoch: 0 };
}

// ---- a fake RPC that counts calls and can answer 429 ----
function fakeChain(accounts: Map<string, AccountInfo<Buffer>>, opts: { limited?: () => boolean } = {}) {
  const calls: Record<string, number> = {};
  const hit = async (m: string) => {
    calls[m] = (calls[m] ?? 0) + 1;
    await new Promise((r) => setTimeout(r, 5));
    if (opts.limited?.()) throw new Error(`failed to get info: Error: 429 : {"error":"Too many requests"}`);
  };
  const conn = {
    getAccountInfo: async (k: PublicKey) => (await hit("getAccountInfo"), accounts.get(k.toBase58()) ?? null),
    getAccountInfoAndContext: async (k: PublicKey) => (await hit("getAccountInfo"), { context: { slot: 1 }, value: accounts.get(k.toBase58()) ?? null }),
    getMultipleAccountsInfo: async (ks: PublicKey[]) => (await hit("getMultipleAccounts"), ks.map((k) => accounts.get(k.toBase58()) ?? null)),
    getSlot: async () => (await hit("getSlot"), 100),
    getBlockTime: async () => (await hit("getBlockTime"), 1_800_000_100),
    getSignaturesForAddress: async () => (
      await hit("getSignaturesForAddress"), [{ signature: "sigA", blockTime: 1_800_000_000, err: null, confirmationStatus: "confirmed" }]
    ),
    getTransaction: async () => (await hit("getTransaction"), { blockTime: 1_800_000_000, meta: { logMessages: [] } }),
  };
  return { conn: conn as unknown as Connection, calls };
}

const cluster = { name: "test", programId: programId.toBase58(), rpcUrls: ["http://rpc.invalid"], tokenDecimals: 6, explorerTx: "https://x/{sig}" } as unknown as RuntimeCluster;
const store = { getWarrantyTerms: async () => null };

async function world(claimCount = 0) {
  const w = warrantyAcc({ claimCount, status: claimCount > 0 ? WarrantyStatus.Claimed : WarrantyStatus.Active, openClaim: claimCount });
  // raw() keeps only the account's own fields, so the fixtures' extra `address` drops out.
  const m = new Map<string, AccountInfo<Buffer>>([
    [pda.toBase58(), await account("warranty", w)],
    [keys.shop.toBase58(), await account("shop", shopAcc())],
    [configPda(programId).toBase58(), await account("config", { admin: keys.owner, limits })],
  ]);
  if (claimCount > 0) {
    m.set(claimPda(programId, pda, claimCount - 1).toBase58(), await account("claim", claimAcc({ index: claimCount - 1 })));
  }
  return m;
}

const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

beforeEach(() => resetReadCaches());

describe("readWarranty under many readers", () => {
  it("serves 8 simultaneous readers of one warranty with one upstream read", async () => {
    let t = 0;
    const { conn, calls } = fakeChain(await world());
    const results = await Promise.all(Array.from({ length: 8 }, () => readWarranty(pda.toBase58(), { store, cluster, conn, now: () => t })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(calls.getSignaturesForAddress).toBe(1);
    expect(calls.getMultipleAccounts).toBe(1);
    // Within ttlMs the same answer is reused without touching the RPC.
    const before = total(calls);
    t += rc.ttlMs - 1;
    expect((await readWarranty(pda.toBase58(), { store, cluster, conn, now: () => t })).ok).toBe(true);
    expect(total(calls)).toBe(before);
  });

  it("makes a repeat read two RPC calls: one getMultipleAccounts and one getSignaturesForAddress; confirmed steps are not read again", async () => {
    let t = 0;
    const { conn, calls } = fakeChain(await world(1));
    const first = await readWarranty(pda.toBase58(), { store, cluster, conn, now: () => t });
    expect(first.ok && first.view.claim?.address).toBe(claimPda(programId, pda, 0).toBase58());
    expect(calls.getTransaction).toBe(1);
    for (const k of Object.keys(calls)) delete calls[k];
    t += rc.ttlMs;
    const again = await readWarranty(pda.toBase58(), { store, cluster, conn, now: () => t });
    expect(again.ok && again.view.claim?.address).toBe(claimPda(programId, pda, 0).toBase58());
    expect(calls).toEqual({ getMultipleAccounts: 1, getSignaturesForAddress: 1 });
  });

  it("picks up a claim filed after the first read in the same single call", async () => {
    let t = 0;
    const accounts = await world(0);
    const { conn, calls } = fakeChain(accounts);
    await readWarranty(pda.toBase58(), { store, cluster, conn, now: () => t });
    for (const [k, v] of await world(1)) accounts.set(k, v);
    for (const k of Object.keys(calls)) delete calls[k];
    t += rc.ttlMs;
    const r = await readWarranty(pda.toBase58(), { store, cluster, conn, now: () => t });
    expect(r.ok && r.view.claim?.address).toBe(claimPda(programId, pda, 0).toBase58());
    expect(calls.getMultipleAccounts).toBe(1);
    expect(calls.getAccountInfo).toBeUndefined();
  });

  it("retries once after a 429, then answers network with retryAfterSecs; that failure is not kept", async () => {
    let limited = true;
    const { conn } = fakeChain(await world(), { limited: () => limited });
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const r = await readWarranty(pda.toBase58(), { store, cluster, conn, sleep });
    expect(r).toEqual({ ok: false, reason: "network", retryAfterSecs: rc.retryAfterSecs });
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(rc.rateRetryMs[0]!);
    expect(waits[0]).toBeLessThanOrEqual(rc.rateRetryMs[1]!);
    limited = false;
    expect((await readWarranty(pda.toBase58(), { store, cluster, conn, sleep })).ok).toBe(true);
  });
});

describe("read cache parts", () => {
  it("shares a running load and drops a failed one", async () => {
    let loads = 0;
    const reads = new SharedReads<number>(1000, 10);
    const slow = () => new Promise<number>((r) => setTimeout(() => r(++loads), 5));
    expect(await Promise.all([reads.get("a", slow), reads.get("a", slow), reads.get("a", slow)])).toEqual([1, 1, 1]);
    await expect(new SharedReads<number>(1000, 10).get("b", () => Promise.reject(new Error("x")))).rejects.toThrow();
    const keepNone = new SharedReads<number>(1000, 10, () => false);
    await keepNone.get("c", slow);
    expect(await keepNone.get("c", slow)).toBe(loads);
  });

  it("does not retry other errors", async () => {
    let n = 0;
    await expect(withRateRetry(async () => { n++; throw new Error("timeout"); }, { waitMs: [0, 0], sleep: async () => {} })).rejects.toThrow("timeout");
    expect(n).toBe(1);
    await expect(withRateRetry(async () => { throw new Error("429 : busy"); }, { waitMs: [0, 0], sleep: async () => {} })).rejects.toBeInstanceOf(RateLimited);
  });

  it("recognises 429 the way web3.js reports it through the failover connection", async () => {
    const fetchImpl = (async () => new Response('{"error":"rate limited"}', { status: 429 })) as unknown as typeof fetch;
    const conn = failoverConnection({ urls: ["http://a.invalid", "http://b.invalid"], timeoutMs: 1000, retryStatuses: [429], fetchImpl });
    const err = await conn.getAccountInfo(pda).catch((e: unknown) => e);
    expect(isRateLimited(err)).toBe(true);
    expect(isRateLimited(new Error(`failed to get info about account ${pda.toBase58()}: fetch failed`))).toBe(false);
  });

  it("turns the read result into 200, 503 + Retry-After, or 502", async () => {
    expect(readResponse({ ok: true, view: view() }).status).toBe(200);
    const busy = readResponse({ ok: false, reason: "network", retryAfterSecs: 3 });
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("3");
    expect(await busy.json()).toEqual({ error: "busy" });
    expect(readResponse({ ok: false, reason: "network" }).status).toBe(502);
    expect(readResponse({ ok: false, reason: "not_found" }).status).toBe(404);
  });
});
