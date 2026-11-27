// Shared reads for /api/warranty/[pda] and /w/[pda]: one read per warranty at a time, reused for a short while.
// Many visitors following the same card (the demo, a judge with several tabs) then cost the public RPC one read.

/** Did every RPC endpoint answer 429? web3.js reports it as "429 : <body>", sometimes wrapped in another message. */
export function isRateLimited(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : String(e);
  return /(^|[^\w])429\b/.test(text);
}

/** Thrown by a load when the RPC kept answering 429; the route turns it into 503 + Retry-After. */
export class RateLimited extends Error {
  constructor() {
    super("rpc_rate_limited");
  }
}

export interface RetryOptions {
  /** Random wait before the one retry, in ms: [min, max]. */
  waitMs: readonly [number, number];
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs `load`; after a 429 waits a jittered moment and tries once more; a second 429 becomes RateLimited. */
export async function withRateRetry<T>(load: () => Promise<T>, o: RetryOptions): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (!isRateLimited(e)) throw e;
  }
  const [min, max] = o.waitMs;
  await (o.sleep ?? realSleep)(min + Math.floor((o.random ?? Math.random)() * Math.max(0, max - min)));
  try {
    return await load();
  } catch (e) {
    throw isRateLimited(e) ? new RateLimited() : e;
  }
}

interface Slot<T> {
  at: number;
  value: Promise<T>;
}

/**
 * Single-flight cache: callers asking for a key while its load runs share that load; a result that `keep` accepts is
 * reused for ttlMs. Rejected loads and results `keep` refuses are dropped as soon as they settle.
 */
export class SharedReads<T> {
  private slots = new Map<string, Slot<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries: number,
    private keep: (value: T) => boolean = () => true,
    private now: () => number = Date.now,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.slots.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    if (hit) this.slots.delete(key);
    if (this.slots.size >= this.maxEntries) {
      const oldest = this.slots.keys().next().value;
      if (oldest !== undefined) this.slots.delete(oldest);
    }
    const slot: Slot<T> = { at: this.now(), value: load() };
    this.slots.set(key, slot);
    const drop = () => {
      if (this.slots.get(key) === slot) this.slots.delete(key);
    };
    slot.value.then((v) => (this.keep(v) ? undefined : drop()), drop);
    // A slot's settled time counts from when the load started: a slow read is not kept longer than a quick one.
    return slot.value;
  }
}

/** A value read at most once every ttlMs (a failed read is retried next time). */
export class Remembered<T> {
  private at = -Infinity;
  private value: Promise<T> | null = null;

  constructor(
    private ttlMs: number,
    private now: () => number = Date.now,
  ) {}

  get(load: () => Promise<T>): Promise<T> {
    if (this.value && this.now() - this.at < this.ttlMs) return this.value;
    this.at = this.now();
    const p = load();
    this.value = p;
    p.catch(() => {
      if (this.value === p) this.value = null;
    });
    return p;
  }
}

/** A bounded map: the oldest entry goes first once maxEntries is reached. */
export class BoundedMap<V> extends Map<string, V> {
  constructor(private maxEntries: number) {
    super();
  }

  override set(key: string, value: V): this {
    if (!this.has(key) && this.size >= this.maxEntries) {
      const oldest = this.keys().next().value;
      if (oldest !== undefined) this.delete(oldest);
    }
    return super.set(key, value);
  }
}
