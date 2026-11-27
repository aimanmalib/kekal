// /kedai/[owner]: the public record of one shop, read from the chain through readShopBoard and kept for
// web.shopPage.cacheSecs so a page shared on a quote does not cost one program scan per visitor.
import { ShopStatus, vaultPda } from "@kekal/sdk";
import { PublicKey } from "@solana/web3.js";
import { webConfig } from "../web-config";
import type { ShopBoard, ShopSummary } from "./board";

export interface PublicShop {
  owner: string;
  programId: string;
  decimals: number;
  /** Chain time of the read (null when the cluster did not say); the page counts from it. */
  chainNow: number | null;
  shop: ShopSummary;
  vault: string;
  /** When the next heartbeat is due: after this the shop is late, after shop.silentAt anyone may mark it silent. */
  checkInDue: number;
}

export type ShopState = "active" | "late" | "silent";

/** The public view of a board, or null when the owner has no shop. Claims and card holders are left out on purpose. */
export function publicShop(board: ShopBoard): PublicShop | null {
  const s = board.shop;
  if (!s) return null;
  return {
    owner: board.owner,
    programId: board.programId,
    decimals: board.decimals,
    chainNow: board.chainNow,
    shop: s,
    vault: vaultPda(new PublicKey(board.programId), new PublicKey(s.address)).toBase58(),
    checkInDue: s.lastSeen + s.windows.heartbeatSecs,
  };
}

export function shopState(p: PublicShop, now: number): ShopState {
  if (p.shop.status !== ShopStatus.Active) return "silent";
  return now > p.checkInDue ? "late" : "active";
}

export interface CacheSettings {
  cacheSecs: number;
  cacheMax: number;
}

type Entry = { at: number; shop: PublicShop | null };

/** A small time-boxed cache in front of a board reader. Network errors are thrown and never cached. */
export function publicShopReader(read: (owner: PublicKey) => Promise<ShopBoard>, settings: CacheSettings) {
  const cache = new Map<string, Entry>();
  return async function readPublicShop(owner: PublicKey, nowMs: number): Promise<PublicShop | null> {
    const key = owner.toBase58();
    const hit = cache.get(key);
    if (hit && nowMs - hit.at < settings.cacheSecs * 1000) return hit.shop;
    const shop = publicShop(await read(owner));
    cache.delete(key);
    cache.set(key, { at: nowMs, shop });
    while (cache.size > settings.cacheMax) cache.delete(cache.keys().next().value!);
    return shop;
  };
}

export const shopPageSettings = webConfig.shopPage;
