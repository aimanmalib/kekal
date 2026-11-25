import { describe, expect, it } from "vitest";
import { activateCard, addPending, pendingKey, resolveKey, type KeyStorage } from "../src/lib/warranty/card-store";
import { ActionError, encodeSeed, keypairFromSeed } from "../src/lib/warranty/client";

const KEY = "kekal.card.TestWarranty";

function memory(): KeyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const seedOf = (n: number) => new Uint8Array(32).fill(n);
const pub = (seed: Uint8Array) => keypairFromSeed(seed).publicKey.toBase58();
const CARD = pub(seedOf(9));
const NO_WAIT = { tries: 1, waitMs: 0 };

describe("card key storage: activation cannot lose the new key", () => {
  it("the new key is in storage before the transaction is sent", async () => {
    const st = memory();
    const seed = seedOf(1);
    let seenAtSend: string | null = null;
    await activateCard(seed, {
      storage: st,
      storageKey: KEY,
      maxPending: 4, recheck: NO_WAIT,
      send: async () => {
        seenAtSend = st.getItem(pendingKey(KEY));
        return "sig";
      },
      chainHolder: async () => CARD,
    });
    expect(seenAtSend).toContain(encodeSeed(seed));
  });

  it("a confirmed send saves the key and clears the pending slot", async () => {
    const st = memory();
    const r = await activateCard(seedOf(1), { storage: st, storageKey: KEY, maxPending: 4, recheck: NO_WAIT, send: async () => "sig1", chainHolder: async () => CARD });
    expect(r).toEqual({ kind: "confirmed", signature: "sig1", seed: encodeSeed(seedOf(1)) });
    expect(st.getItem(KEY)).toBe(encodeSeed(seedOf(1)));
    expect(st.getItem(pendingKey(KEY))).toBeNull();
  });

  it("not_confirmed but the chain shows the new holder: the key is recovered and saved", async () => {
    const st = memory();
    const seed = seedOf(2);
    const r = await activateCard(seed, {
      storage: st,
      storageKey: KEY,
      maxPending: 4, recheck: NO_WAIT,
      send: async () => {
        throw new ActionError("not_confirmed");
      },
      chainHolder: async () => pub(seed),
    });
    expect(r.kind).toBe("landed");
    expect(r.seed).toBe(encodeSeed(seed));
    expect(st.getItem(KEY)).toBe(encodeSeed(seed));
    expect(st.getItem(pendingKey(KEY))).toBeNull();
  });

  it("a failed send with the card still holding rethrows and keeps the pending key for a later visit", async () => {
    const st = memory();
    const seed = seedOf(3);
    const err = new ActionError("not_confirmed");
    await expect(
      activateCard(seed, { storage: st, storageKey: KEY, maxPending: 4, recheck: NO_WAIT, send: async () => Promise.reject(err), chainHolder: async () => CARD }),
    ).rejects.toBe(err);
    expect(st.getItem(KEY)).toBeNull();
    expect(st.getItem(pendingKey(KEY))).toBe(encodeSeed(seed));
  });

  it("the chain cannot be read after a failed send: the original error stands and the pending key stays", async () => {
    const st = memory();
    const err = new ActionError("network");
    await expect(
      activateCard(seedOf(4), {
        storage: st,
        storageKey: KEY,
        maxPending: 4, recheck: NO_WAIT,
        send: async () => Promise.reject(err),
        chainHolder: async () => Promise.reject(new ActionError("network")),
      }),
    ).rejects.toBe(err);
    expect(st.getItem(pendingKey(KEY))).toBe(encodeSeed(seedOf(4)));
  });

  it("a send that lands only after the error is found by the repeated holder reads", async () => {
    const st = memory();
    const seed = seedOf(15);
    const holders = [CARD, CARD, pub(seed)];
    const waits: number[] = [];
    const r = await activateCard(seed, {
      storage: st,
      storageKey: KEY,
      maxPending: 4,
      recheck: { tries: 3, waitMs: 2000 },
      wait: async (ms) => void waits.push(ms),
      send: async () => Promise.reject(new ActionError("network")),
      chainHolder: async () => holders.shift()!,
    });
    expect(r.kind).toBe("landed");
    expect(waits).toEqual([2000, 2000]);
    expect(st.getItem(KEY)).toBe(encodeSeed(seed));
  });

  it("a later visit promotes the pending key once the chain shows it as holder (tab closed while waiting)", () => {
    const st = memory();
    addPending(st, KEY, seedOf(5), 4);
    expect(resolveKey(st, KEY, CARD)).toEqual({ seed: null, promoted: false });
    expect(st.getItem(pendingKey(KEY))).not.toBeNull();
    expect(resolveKey(st, KEY, pub(seedOf(5)))).toEqual({ seed: encodeSeed(seedOf(5)), promoted: true });
    expect(st.getItem(KEY)).toBe(encodeSeed(seedOf(5)));
    expect(resolveKey(st, KEY, pub(seedOf(5)))).toEqual({ seed: encodeSeed(seedOf(5)), promoted: false });
  });

  it("two tries: whichever pending key landed is the one promoted; the list is capped", () => {
    const st = memory();
    for (const n of [10, 11, 12, 13, 14]) addPending(st, KEY, seedOf(n), 4);
    expect(st.getItem(pendingKey(KEY))!.split(" ")).toHaveLength(4);
    expect(resolveKey(st, KEY, pub(seedOf(10))).promoted).toBe(false);
    expect(resolveKey(st, KEY, pub(seedOf(12)))).toEqual({ seed: encodeSeed(seedOf(12)), promoted: true });
  });

  it("a saved key that is the holder clears stale pending keys", () => {
    const st = memory();
    st.setItem(KEY, encodeSeed(seedOf(6)));
    addPending(st, KEY, seedOf(7), 4);
    expect(resolveKey(st, KEY, pub(seedOf(6)))).toEqual({ seed: encodeSeed(seedOf(6)), promoted: false });
    expect(st.getItem(pendingKey(KEY))).toBeNull();
  });
});

describe("chainHolder: re-reads the holder after an unconfirmed send", () => {
  it("asks /api/rpc for only the 32 holder bytes of a program-owned account and decodes them", async () => {
    const { accountFieldOffset } = await import("@kekal/sdk");
    const { chainHolder } = await import("../src/lib/warranty/program");
    const holderBytes = keypairFromSeed(seedOf(8)).publicKey.toBytes();
    let sent: { method: string; params: [string, { dataSlice: { offset: number; length: number } }] } | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      const data = btoa(String.fromCharCode(...holderBytes));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: { owner: "Prog111", data: [data, "base64"] } } }));
    }) as typeof fetch;
    try {
      expect(await chainHolder("WarrantyPda", "Prog111")).toBe(pub(seedOf(8)));
      expect(sent!.method).toBe("getAccountInfo");
      expect(sent!.params[1].dataSlice).toEqual({ offset: accountFieldOffset("Warranty", "holder"), length: 32 });
      await expect(chainHolder("WarrantyPda", "OtherProgram")).rejects.toBeInstanceOf(ActionError);
    } finally {
      globalThis.fetch = original;
    }
  });
});
