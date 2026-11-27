// Server side of /w/[pda]: reads the warranty, its shop, the latest claim, the terms text and recent transactions.
import {
  claimPda,
  decodeAccount,
  fetchConfig,
  hashJson,
  parseKekalEvents,
  readOnlyProgram,
  ShopStatus,
  sha256Bytes,
  toHex,
  type ClaimAccount,
  type KekalProgram,
  type ShopAccount,
  type WarrantyAccount,
} from "@kekal/sdk";
import { explorerTxUrl, failoverConnection, runtimeCluster, type DataStore, type RuntimeCluster } from "@kekal/server";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { webConfig } from "../config";
import { BoundedMap, RateLimited, Remembered, SharedReads, withRateRetry } from "./read-cache";
import { buildView, type TimelineEntry, type WarrantyView } from "./view";

/** retryAfterSecs is set when the RPC endpoints kept answering 429: the route answers 503 with Retry-After. */
export type ReadResult =
  | { ok: true; view: WarrantyView }
  | { ok: false; reason: "bad_address" | "not_found" }
  | { ok: false; reason: "network"; retryAfterSecs?: number };

/** A base58 Solana address, or null. Never throws. */
export function parseAddress(raw: string): PublicKey | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

/** Does the stored terms text hash to the on-chain terms_hash? Text is compared byte for byte, then as canonical JSON. */
export function termsMatch(termsJson: string, termsHash: Uint8Array): boolean {
  const want = toHex(termsHash);
  if (toHex(sha256Bytes(new TextEncoder().encode(termsJson))) === want) return true;
  try {
    return toHex(hashJson(JSON.parse(termsJson))) === want;
  } catch {
    return false;
  }
}

/** Decoded events per signature; confirmed transactions do not change, so entries are kept until the cap. */
const eventCache = new Map<string, Omit<TimelineEntry, "explorer">>();
function remember(sig: string, entry: Omit<TimelineEntry, "explorer">) {
  if (eventCache.size >= webConfig.warrantyPage.eventCacheSize) {
    const oldest = eventCache.keys().next().value;
    if (oldest !== undefined) eventCache.delete(oldest);
  }
  eventCache.set(sig, entry);
}

function numberField(v: unknown): string {
  return typeof v === "object" && v !== null && "toString" in v ? String(v) : String(v ?? "0");
}

export function timelineEntry(program: KekalProgram, sig: string, blockTime: number | null, failed: boolean, logs: readonly string[]) {
  const events = failed ? [] : parseKekalEvents(program, logs);
  const entry: Omit<TimelineEntry, "explorer"> = { signature: sig, blockTime, failed, events: events.map((e) => e.name) };
  const paid = events.find((e) => e.name === "ReservePaid");
  if (paid) entry.paid = { amount: numberField(paid.data.amount), claimStatus: Number(paid.data.claimStatus ?? paid.data.claim_status) };
  const moved = events.find((e) => e.name === "HolderTransferred");
  if (moved) entry.newHolder = String((moved.data.newHolder ?? moved.data.new_holder) as PublicKey);
  return entry;
}

async function readTimeline(conn: Connection, program: KekalProgram, pda: PublicKey, cluster: RuntimeCluster): Promise<TimelineEntry[]> {
  const sigs = await conn.getSignaturesForAddress(pda, { limit: webConfig.warrantyPage.timelineLimit });
  const entries = await Promise.all(
    sigs.map(async (s) => {
      let e = eventCache.get(s.signature);
      if (!e) {
        const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
        e = timelineEntry(program, s.signature, s.blockTime ?? tx?.blockTime ?? null, s.err !== null, tx?.meta?.logMessages ?? []);
        if (tx && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) remember(s.signature, e);
      }
      return { ...e, explorer: explorerTxUrl(cluster, s.signature) };
    }),
  );
  return entries;
}

/**
 * Marking a shop silent touches the shop, not its warranties, so it is missing from a warranty's own history. For a
 * silent shop that transaction is looked up among the shop's recent ones and merged in, newest first.
 */
export function withShopSilence(timeline: TimelineEntry[], shopEntries: TimelineEntry[]): TimelineEntry[] {
  const known = new Set(timeline.map((e) => e.signature));
  const extra = shopEntries.filter((e) => !e.failed && e.events.includes("ShopDeclaredDormant") && !known.has(e.signature));
  if (extra.length === 0) return timeline;
  return [...timeline, ...extra].sort((a, b) => (b.blockTime ?? Number.MAX_SAFE_INTEGER) - (a.blockTime ?? Number.MAX_SAFE_INTEGER));
}

/** Unix time of the latest confirmed block. Programs check deadlines against this clock, not ours. */
async function chainTime(conn: Connection): Promise<number> {
  const t = await conn.getBlockTime(await conn.getSlot("confirmed"));
  if (t === null) throw new Error("no block time");
  return t;
}

export interface ReadDeps {
  store: Pick<DataStore, "getWarrantyTerms">;
  cluster?: RuntimeCluster;
  conn?: Connection;
  /** Test hooks: the wait before the one retry after a 429, and the wall clock in ms. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const rc = webConfig.warrantyPage.readCache;

/** What a repeat read needs to fetch everything at once: the shop never changes, the claim count only grows. */
interface Shape {
  shop: PublicKey;
  claimCount: number;
}

/** Per cluster and program: shared reads, remembered shapes, config, clock offset and shop silence entries. */
interface Caches {
  reads: SharedReads<ReadResult>;
  shapes: BoundedMap<Shape>;
  config: Remembered<Awaited<ReturnType<typeof fetchConfig>>>;
  /** Chain clock minus wall clock, in seconds. */
  skew: Remembered<number>;
  silence: BoundedMap<TimelineEntry[]>;
}

const caches = new Map<string, Caches>();
function cachesFor(scope: string, now: () => number): Caches {
  let c = caches.get(scope);
  if (!c) {
    c = {
      reads: new SharedReads<ReadResult>(rc.ttlMs, rc.maxEntries, (r) => r.ok || r.reason !== "network", now),
      shapes: new BoundedMap(rc.maxEntries),
      config: new Remembered(rc.configSecs * 1000, now),
      skew: new Remembered(rc.clockSecs * 1000, now),
      silence: new BoundedMap(rc.maxEntries),
    };
    caches.set(scope, c);
  }
  return c;
}

/** Test hook: forget every cached read. */
export function resetReadCaches() {
  caches.clear();
  eventCache.clear();
}

export async function readWarranty(raw: string, deps: ReadDeps): Promise<ReadResult> {
  const pda = parseAddress(raw);
  if (!pda) return { ok: false, reason: "bad_address" };
  const cluster = deps.cluster ?? runtimeCluster();
  const now = deps.now ?? Date.now;
  const c = cachesFor(`${cluster.name}:${cluster.programId}`, now);
  return c.reads.get(pda.toBase58(), async () => {
    const conn =
      deps.conn ?? failoverConnection({ urls: cluster.rpcUrls, timeoutMs: webConfig.rpc.timeoutMs, retryStatuses: webConfig.rpc.retryStatuses });
    try {
      return await withRateRetry(() => readOnce(pda, conn, cluster, c, deps, now), { waitMs: [rc.rateRetryMs[0]!, rc.rateRetryMs[1]!], sleep: deps.sleep });
    } catch (e) {
      return e instanceof RateLimited ? { ok: false, reason: "network", retryAfterSecs: rc.retryAfterSecs } : { ok: false, reason: "network" };
    }
  });
}

/**
 * One read. The first read of a warranty fetches it alone to learn its shop and claim count; later reads fetch the
 * warranty, its shop and the latest (and next) claim in one getMultipleAccounts, then its recent signatures: two RPC
 * calls, plus one getTransaction per signature not seen before. Throws on network trouble.
 */
async function readOnce(pda: PublicKey, conn: Connection, cluster: RuntimeCluster, c: Caches, deps: ReadDeps, now: () => number): Promise<ReadResult> {
  const program = readOnlyProgram(conn, new PublicKey(cluster.programId));
  const claimKey = (n: number) => claimPda(program.programId, pda, n);
  const fetched = new Map<string, AccountInfo<Buffer> | null>();
  const fetchMany = async (keys: PublicKey[]) => {
    const infos = await conn.getMultipleAccountsInfo(keys);
    keys.forEach((k, i) => fetched.set(k.toBase58(), infos[i] ?? null));
  };
  const shape = c.shapes.get(pda.toBase58());
  if (shape) {
    const claims = shape.claimCount > 0 ? [claimKey(shape.claimCount - 1), claimKey(shape.claimCount)] : [claimKey(0)];
    await fetchMany([pda, shape.shop, ...claims]);
  } else {
    fetched.set(pda.toBase58(), await conn.getAccountInfo(pda));
  }
  const info = fetched.get(pda.toBase58());
  if (!info || !info.owner.equals(program.programId)) return { ok: false, reason: "not_found" };
  let warranty: WarrantyAccount;
  try {
    warranty = decodeAccount<WarrantyAccount>(program, "warranty", info.data);
  } catch {
    return { ok: false, reason: "not_found" };
  }
  c.shapes.set(pda.toBase58(), { shop: warranty.shop, claimCount: warranty.claimCount });
  const claimAt = warranty.claimCount > 0 ? claimKey(warranty.claimCount - 1) : null;
  const missing = [warranty.shop, ...(claimAt ? [claimAt] : [])].filter((k) => !fetched.has(k.toBase58()));
  const [, config, timeline, skew] = await Promise.all([
    missing.length > 0 ? fetchMany(missing) : Promise.resolve(),
    c.config.get(() => fetchConfig(program)),
    readTimeline(conn, program, pda, cluster),
    c.skew.get(async () => (await chainTime(conn)) - Math.floor(now() / 1000)).catch(() => 0),
  ]);
  const shopInfo = fetched.get(warranty.shop.toBase58());
  const claimInfo = claimAt ? fetched.get(claimAt.toBase58()) : null;
  if (!shopInfo || !config) return { ok: false, reason: "not_found" };
  const shop = decodeAccount<ShopAccount>(program, "shop", shopInfo.data);
  const silence = shop.status === ShopStatus.Dormant ? await shopSilence(conn, program, warranty.shop, cluster, c) : [];
  const claim = claimInfo && claimAt ? decodeAccount<ClaimAccount>(program, "claim", claimInfo.data) : null;
  const json = await deps.store.getWarrantyTerms(pda.toBase58());
  const view = buildView({
    pda: pda.toBase58(),
    programId: program.programId.toBase58(),
    decimals: cluster.tokenDecimals,
    warranty,
    shop: { ...shop, address: warranty.shop.toBase58() },
    claim: claim && claimAt ? { ...claim, address: claimAt.toBase58() } : null,
    limits: config.limits,
    terms: { json, matches: json === null ? null : termsMatch(json, warranty.termsHash) },
    timeline: withShopSilence(timeline, silence),
    clockSkew: skew,
  });
  return { ok: true, view };
}

/** The transaction that marked a silent shop silent; once found it never changes, so it is kept per shop. */
async function shopSilence(conn: Connection, program: KekalProgram, shop: PublicKey, cluster: RuntimeCluster, c: Caches): Promise<TimelineEntry[]> {
  const kept = c.silence.get(shop.toBase58());
  if (kept) return kept;
  const found = (await readTimeline(conn, program, shop, cluster)).filter((e) => !e.failed && e.events.includes("ShopDeclaredDormant"));
  if (found.length > 0) c.silence.set(shop.toBase58(), found);
  return found;
}
