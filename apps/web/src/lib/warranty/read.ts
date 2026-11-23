// Server side of /w/[pda]: reads the warranty, its shop, the latest claim, the terms text and recent transactions.
import {
  claimPda,
  decodeAccount,
  fetchConfig,
  hashJson,
  parseKekalEvents,
  readOnlyProgram,
  sha256Bytes,
  toHex,
  type ClaimAccount,
  type KekalProgram,
  type ShopAccount,
  type WarrantyAccount,
} from "@kekal/sdk";
import { explorerTxUrl, failoverConnection, runtimeCluster, type DataStore, type RuntimeCluster } from "@kekal/server";
import { PublicKey, type Connection } from "@solana/web3.js";
import { webConfig } from "../config";
import { buildView, type TimelineEntry, type WarrantyView } from "./view";

export type ReadResult =
  | { ok: true; view: WarrantyView }
  | { ok: false; reason: "bad_address" | "not_found" | "network" };

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

/** Decoded events per signature; finalised transactions never change, so entries are kept until the cap. */
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
        if (s.confirmationStatus === "finalized") remember(s.signature, e);
      }
      return { ...e, explorer: explorerTxUrl(cluster, s.signature) };
    }),
  );
  return entries;
}

/** Unix time of the latest confirmed block, or null. Programs check deadlines against this clock, not ours. */
async function chainTime(conn: Connection): Promise<number | null> {
  try {
    return await conn.getBlockTime(await conn.getSlot("confirmed"));
  } catch {
    return null;
  }
}

export interface ReadDeps {
  store: Pick<DataStore, "getWarrantyTerms">;
  cluster?: RuntimeCluster;
  conn?: Connection;
}

export async function readWarranty(raw: string, deps: ReadDeps): Promise<ReadResult> {
  const pda = parseAddress(raw);
  if (!pda) return { ok: false, reason: "bad_address" };
  const cluster = deps.cluster ?? runtimeCluster();
  const conn =
    deps.conn ?? failoverConnection({ urls: cluster.rpcUrls, timeoutMs: webConfig.rpc.timeoutMs, retryStatuses: webConfig.rpc.retryStatuses });
  const program = readOnlyProgram(conn, new PublicKey(cluster.programId));
  try {
    const info = await conn.getAccountInfo(pda);
    if (!info || !info.owner.equals(program.programId)) return { ok: false, reason: "not_found" };
    let warranty: WarrantyAccount;
    try {
      warranty = decodeAccount<WarrantyAccount>(program, "warranty", info.data);
    } catch {
      return { ok: false, reason: "not_found" };
    }
    const claimKey = warranty.claimCount > 0 ? claimPda(program.programId, pda, warranty.claimCount - 1) : null;
    const [shopInfo, claimInfo, config, timeline, chainNow] = await Promise.all([
      conn.getAccountInfo(warranty.shop),
      claimKey ? conn.getAccountInfo(claimKey) : Promise.resolve(null),
      fetchConfig(program),
      readTimeline(conn, program, pda, cluster),
      chainTime(conn),
    ]);
    if (!shopInfo || !config) return { ok: false, reason: "not_found" };
    const shop = decodeAccount<ShopAccount>(program, "shop", shopInfo.data);
    const claim = claimInfo && claimKey ? decodeAccount<ClaimAccount>(program, "claim", claimInfo.data) : null;
    const json = deps.store.getWarrantyTerms(pda.toBase58());
    const view = buildView({
      pda: pda.toBase58(),
      programId: program.programId.toBase58(),
      decimals: cluster.tokenDecimals,
      warranty,
      shop: { ...shop, address: warranty.shop.toBase58() },
      claim: claim && claimKey ? { ...claim, address: claimKey.toBase58() } : null,
      limits: config.limits,
      terms: { json, matches: json === null ? null : termsMatch(json, warranty.termsHash) },
      timeline,
      clockSkew: chainNow === null ? 0 : chainNow - Math.floor(Date.now() / 1000),
    });
    return { ok: true, view };
  } catch {
    return { ok: false, reason: "network" };
  }
}
