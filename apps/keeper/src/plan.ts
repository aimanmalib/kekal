// What the keeper should send this pass. Pure: decoded accounts and the cluster clock in, actions out.
import {
  isDue,
  scheduleShop,
  scheduleWarranty,
  type ClaimAccount,
  type PermissionlessAction,
  type ShopAccount,
  type WarrantyAccount,
} from "@kekal/sdk";
import type { PublicKey } from "@solana/web3.js";

export interface Keyed<T> {
  key: PublicKey;
  account: T;
}

export interface LiveWarranty extends Keyed<WarrantyAccount> {
  /** The open claim (index `open_claim`) when the warranty is Claimed, else null. */
  claim: Keyed<ClaimAccount> | null;
}

export interface Action {
  action: Exclude<PermissionlessAction, "declareDormant">;
  shop: PublicKey;
  warranty: PublicKey;
  claim: PublicKey | null;
  dueAt: number;
}

/** Shops whose heartbeat and grace have run out: declare these dormant before anything else (ADR 0005). */
export function dueDormant(shops: Keyed<ShopAccount>[], now: number): PublicKey[] {
  return shops.filter((s) => isDue(scheduleShop(s.account), now)).map((s) => s.key);
}

/** Every due warranty step, oldest first, capped at `max`. Warranties of unknown shops are skipped. */
export function dueWarrantyActions(
  shops: Map<string, ShopAccount>,
  warranties: LiveWarranty[],
  now: number,
  disputeTimeoutSecs: number,
  max: number,
): Action[] {
  const out: Action[] = [];
  for (const w of warranties) {
    const shop = shops.get(w.account.shop.toBase58());
    if (!shop) continue;
    const s = scheduleWarranty(shop, w.account, w.claim?.account ?? null, disputeTimeoutSecs);
    if (!isDue(s, now) || s.action === "declareDormant") continue;
    out.push({ action: s.action, shop: w.account.shop, warranty: w.key, claim: w.claim?.key ?? null, dueAt: s.dueAt });
  }
  return out.sort((a, b) => a.dueAt - b.dueAt).slice(0, Math.max(0, max));
}

/** True when the role's last heartbeat is older than `everySecs` (or none was sent by this process). */
export function heartbeatDue(lastSentAt: number | undefined, now: number, everySecs: number): boolean {
  return lastSentAt === undefined || now - lastSentAt >= everySecs;
}
