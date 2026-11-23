// Where this browser keeps the card key after activation, and how an activation survives a lost confirmation.
// Activation moves the warranty to a key that exists only in this browser. That key is written to storage as
// "pending" BEFORE the transaction is sent; it becomes the saved key once the chain shows it as the holder, either
// right after confirmation or on any later visit. A timeout, a closed tab or a locked phone therefore cannot lose it.
import { encodeSeed, keypairFromSeed, seedFromFragment } from "./client";

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const pendingKey = (storageKey: string): string => `${storageKey}.pending`;

function publicKeyOf(encoded: string): string | null {
  const seed = seedFromFragment(`s=${encoded}`, "s");
  return seed ? keypairFromSeed(seed).publicKey.toBase58() : null;
}

function readPending(storage: KeyStorage, storageKey: string): string[] {
  const raw = storage.getItem(pendingKey(storageKey));
  return raw ? raw.split(" ").filter((x) => x.length > 0) : [];
}

/**
 * Records a key that is about to become the holder. Earlier pending keys stay (an earlier send may still land);
 * the oldest are dropped beyond `max`.
 */
export function addPending(storage: KeyStorage, storageKey: string, seed: Uint8Array, max: number): void {
  const list = [...readPending(storage, storageKey).filter((x) => x !== encodeSeed(seed)), encodeSeed(seed)];
  storage.setItem(pendingKey(storageKey), list.slice(-Math.max(1, max)).join(" "));
}

export interface ResolvedKey {
  /** Base58 seed of the key this browser should act with, or null. */
  seed: string | null;
  /** True when a pending key was just found to be the holder and moved to the saved slot. */
  promoted: boolean;
}

/**
 * The saved key, after promoting a pending key that the chain now shows as `holder`.
 * Pending keys stay while none of them is the holder and the saved key is not either: their send may still land.
 */
export function resolveKey(storage: KeyStorage, storageKey: string, holder: string): ResolvedKey {
  const saved = storage.getItem(storageKey);
  const pending = readPending(storage, storageKey);
  const match = pending.find((x) => publicKeyOf(x) === holder);
  if (match) {
    storage.setItem(storageKey, match);
    storage.removeItem(pendingKey(storageKey));
    return { seed: match, promoted: true };
  }
  if (saved && pending.length > 0 && publicKeyOf(saved) === holder) storage.removeItem(pendingKey(storageKey));
  return { seed: saved, promoted: false };
}

export interface ActivationDeps {
  storage: KeyStorage;
  storageKey: string;
  maxPending: number;
  /** Sends the activation and resolves with the signature once confirmed; rejects otherwise. */
  send: () => Promise<string>;
  /** Reads the holder from the chain, used when `send` did not report success. */
  chainHolder: () => Promise<string>;
  /** After a failed send the transaction may still be in flight: the holder is read up to `tries` times, `waitMs` apart. */
  recheck: { tries: number; waitMs: number };
  wait?: (ms: number) => Promise<void>;
}

export type ActivationResult =
  | { kind: "confirmed"; signature: string; seed: string }
  | { kind: "landed"; seed: string; cause: unknown };

/**
 * Stores `seed` as pending, sends, and saves it as the card key when the chain confirms or, after a failed or
 * unconfirmed send, when the chain already shows it as holder. Otherwise rethrows the send error; the pending key
 * stays so a later visit can still pick it up.
 */
export async function activateCard(seed: Uint8Array, deps: ActivationDeps): Promise<ActivationResult> {
  const { storage, storageKey } = deps;
  addPending(storage, storageKey, seed, deps.maxPending);
  const encoded = encodeSeed(seed);
  let cause: unknown;
  try {
    const signature = await deps.send();
    storage.setItem(storageKey, encoded);
    storage.removeItem(pendingKey(storageKey));
    return { kind: "confirmed", signature, seed: encoded };
  } catch (e) {
    cause = e;
  }
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < Math.max(1, deps.recheck.tries); i++) {
    if (i > 0) await wait(deps.recheck.waitMs);
    let holder: string;
    try {
      holder = await deps.chainHolder();
    } catch {
      continue; // The chain could not be read; the pending key waits for a later try or visit.
    }
    const r = resolveKey(storage, storageKey, holder);
    if (r.promoted && r.seed) return { kind: "landed", seed: r.seed, cause };
  }
  throw cause;
}
