// Server side of /api/shop/[owner], /api/arbiter/[key] and the home page numbers: program account scans, decoded and
// handed to the pure views in ./board.
import {
  ClaimStatus,
  WarrantyStatus,
  accountFieldOffset,
  byteFieldFilter,
  claimPda,
  decodeAccount,
  discriminatorFilter,
  fetchConfig,
  readOnlyProgram,
  shopPda,
  type ClaimAccount,
  type KekalProgram,
  type ShopAccount,
  type WarrantyAccount,
} from "@kekal/sdk";
import { failoverConnection, runtimeCluster, type RuntimeCluster } from "@kekal/server";
import { PublicKey, type Connection } from "@solana/web3.js";
import { webConfig } from "../config";
import {
  claimRow,
  disputeRow,
  programStats,
  shopSummary,
  sortWarranties,
  warrantyRow,
  type ArbiterBoard,
  type ProgramStats,
  type ShopBoard,
} from "./board";

export interface ChainDeps {
  cluster?: RuntimeCluster;
  conn?: Connection;
}

function open(deps: ChainDeps): { cluster: RuntimeCluster; conn: Connection; program: KekalProgram } {
  const cluster = deps.cluster ?? runtimeCluster();
  const conn =
    deps.conn ?? failoverConnection({ urls: cluster.rpcUrls, timeoutMs: webConfig.rpc.timeoutMs, retryStatuses: webConfig.rpc.retryStatuses });
  return { cluster, conn, program: readOnlyProgram(conn, new PublicKey(cluster.programId)) };
}

async function chainTime(conn: Connection): Promise<number | null> {
  try {
    return await conn.getBlockTime(await conn.getSlot("confirmed"));
  } catch {
    return null;
  }
}

function fieldFilter(account: string, field: string, key: PublicKey) {
  return { memcmp: { offset: accountFieldOffset(account, field), bytes: key.toBase58() } };
}

async function scan<T>(conn: Connection, program: KekalProgram, account: string, name: "shop" | "warranty" | "claim", filters: object[]) {
  const rows = await conn.getProgramAccounts(program.programId, { commitment: "confirmed", filters: [discriminatorFilter(account), ...filters] as never });
  return rows.map((r) => ({ address: r.pubkey.toBase58(), account: decodeAccount<T>(program, name, r.account.data) }));
}

/** The shop of `owner` (null when it has none yet), its cards and its open claims. Network trouble throws. */
export async function readShopBoard(owner: PublicKey, deps: ChainDeps = {}): Promise<ShopBoard> {
  const { cluster, conn, program } = open(deps);
  const shopKey = shopPda(program.programId, owner);
  const [info, config, chainNow] = await Promise.all([conn.getAccountInfo(shopKey, "confirmed"), fetchConfig(program), chainTime(conn)]);
  const base = { owner: owner.toBase58(), programId: program.programId.toBase58(), decimals: cluster.tokenDecimals, chainNow, limits: config?.limits ?? null };
  if (!info || !info.owner.equals(program.programId)) return { ...base, shop: null, warranties: [], claims: [] };
  const shop = decodeAccount<ShopAccount>(program, "shop", info.data);
  const warranties = await scan<WarrantyAccount>(conn, program, "Warranty", "warranty", [fieldFilter("Warranty", "shop", shopKey)]);
  const claimed = warranties.filter((w) => w.account.status === WarrantyStatus.Claimed && w.account.claimCount > 0);
  const claimKeys = claimed.map((w) => claimPda(program.programId, new PublicKey(w.address), w.account.claimCount - 1));
  const claimInfos = claimKeys.length > 0 ? await conn.getMultipleAccountsInfo(claimKeys, "confirmed") : [];
  const claims = claimInfos.flatMap((ci, i) => {
    if (!ci) return [];
    const c = decodeAccount<ClaimAccount>(program, "claim", ci.data);
    return [claimRow(claimKeys[i]!.toBase58(), c, claimed[i]!.account, shop)];
  });
  return {
    ...base,
    shop: shopSummary(shopKey.toBase58(), shop),
    warranties: sortWarranties(warranties.map((w) => warrantyRow(w.address, w.account))),
    claims: claims.sort((a, b) => a.deadline - b.deadline),
  };
}

/** Disputed claims whose shop names `arbiter`, oldest escalation first. Network trouble throws. */
export async function readArbiterBoard(arbiter: PublicKey, deps: ChainDeps = {}): Promise<ArbiterBoard> {
  const { cluster, conn, program } = open(deps);
  const [disputed, config, chainNow] = await Promise.all([
    scan<ClaimAccount>(conn, program, "Claim", "claim", [byteFieldFilter("Claim", "status", ClaimStatus.Disputed)]),
    fetchConfig(program),
    chainTime(conn),
  ]);
  const base = { arbiter: arbiter.toBase58(), programId: program.programId.toBase58(), decimals: cluster.tokenDecimals, chainNow };
  if (disputed.length === 0 || !config) return { ...base, disputes: [] };
  const wKeys = disputed.map((c) => c.account.warranty);
  const wInfos = await conn.getMultipleAccountsInfo(wKeys, "confirmed");
  const warranties = wInfos.map((w, i) => (w ? { address: wKeys[i]!.toBase58(), account: decodeAccount<WarrantyAccount>(program, "warranty", w.data) } : null));
  const shopKeys = [...new Set(warranties.flatMap((w) => (w ? [w.account.shop.toBase58()] : [])))].map((k) => new PublicKey(k));
  const sInfos = shopKeys.length > 0 ? await conn.getMultipleAccountsInfo(shopKeys, "confirmed") : [];
  const shops = new Map(
    sInfos.flatMap((s, i) => (s ? [[shopKeys[i]!.toBase58(), decodeAccount<ShopAccount>(program, "shop", s.data)] as const] : [])),
  );
  const disputes = disputed.flatMap((c, i) => {
    const w = warranties[i];
    const s = w ? shops.get(w.account.shop.toBase58()) : undefined;
    if (!w || !s || !s.arbiter.equals(arbiter)) return [];
    return [disputeRow(c, w, { address: w.account.shop.toBase58(), account: s }, config.limits.disputeTimeoutSecs)];
  });
  return { ...base, disputes: disputes.sort((a, b) => a.escalatedAt - b.escalatedAt) };
}

let statsCache: { at: number; stats: ProgramStats } | undefined;

/** Shops, live cards, locked reserve and paid claims across the program, cached for web.home.statsCacheSecs. */
export async function readProgramStats(now: number, deps: ChainDeps = {}): Promise<ProgramStats> {
  if (statsCache && now - statsCache.at < webConfig.home.statsCacheSecs) return statsCache.stats;
  const { conn, program } = open(deps);
  const [shops, warranties] = await Promise.all([
    scan<ShopAccount>(conn, program, "Shop", "shop", []),
    scan<WarrantyAccount>(conn, program, "Warranty", "warranty", []),
  ]);
  const stats = programStats(
    shops.map((s) => s.account),
    warranties.map((w) => w.account),
  );
  statsCache = { at: now, stats };
  return stats;
}
