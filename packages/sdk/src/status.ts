/** Status codes stored on chain (`programs/kekal/src/state.rs`). */
export const ShopStatus = { Active: 0, Dormant: 1 } as const;
export const WarrantyStatus = { Active: 0, Claimed: 1, PaidOut: 2, Released: 3 } as const;
export const ClaimStatus = {
  Pending: 0,
  Accepted: 1,
  Rejected: 2,
  Disputed: 3,
  Resolved: 4,
  PaidTimeout: 5,
  PaidArbiter: 6,
  Dismissed: 7,
  Closed: 8,
  PaidOrphan: 9,
  PaidStale: 10,
} as const;

type Codes<T> = Record<string, number> & T;
function nameOf<T extends Codes<object>>(table: T, code: number): string {
  const hit = Object.entries(table).find(([, v]) => v === code);
  if (!hit) throw new RangeError(`unknown status code ${code}`);
  return hit[0].charAt(0).toLowerCase() + hit[0].slice(1);
}

/** Locale key for a status, e.g. `status.claim.paidTimeout`. Text lives in `locales/*.json`. */
export const statusKey = {
  shop: (code: number) => `status.shop.${nameOf(ShopStatus, code)}`,
  warranty: (code: number) => `status.warranty.${nameOf(WarrantyStatus, code)}`,
  claim: (code: number) => `status.claim.${nameOf(ClaimStatus, code)}`,
};

const OPEN_CLAIM: ReadonlySet<number> = new Set([
  ClaimStatus.Pending,
  ClaimStatus.Accepted,
  ClaimStatus.Rejected,
  ClaimStatus.Disputed,
]);

export function isClaimOpen(status: number): boolean {
  return OPEN_CLAIM.has(status);
}

export function isWarrantyFinal(status: number): boolean {
  return status === WarrantyStatus.PaidOut || status === WarrantyStatus.Released;
}

/** Minimal views of on-chain accounts needed to decide what is due. Times are unix seconds. */
export interface ShopTimes {
  status: number;
  lastSeen: number;
  dormantAt: number;
  responseSecs: number;
  heartbeatSecs: number;
  graceSecs: number;
  disputeSecs: number;
}
export interface WarrantyTimes {
  status: number;
  expiresAt: number;
}
export interface ClaimTimes {
  status: number;
  filedAt: number;
  repairDeadline: number;
  disputeDeadline: number;
  escalatedAt: number;
}

/** Permissionless instructions (15 to 20). Anyone may send them once due. */
export type PermissionlessAction =
  | "settleUnanswered"
  | "closeStale"
  | "settleStaleDispute"
  | "declareDormant"
  | "claimOrphan"
  | "releaseExpired";

export interface Scheduled {
  action: PermissionlessAction;
  /** First unix second at which the program accepts the instruction (deadlines are strict `>`). */
  dueAt: number;
}

/** When the shop may be declared dormant (instruction 18), or null when already dormant. */
export function scheduleShop(shop: ShopTimes): Scheduled | null {
  if (shop.status !== ShopStatus.Active) return null;
  return { action: "declareDormant", dueAt: shop.lastSeen + shop.heartbeatSecs + shop.graceSecs + 1 };
}

/**
 * The next permissionless step for one warranty, mirroring the program's checks.
 * `claim` is the warranty's open claim (index `open_claim`) or null when none is open.
 */
export function scheduleWarranty(
  shop: ShopTimes,
  warranty: WarrantyTimes,
  claim: ClaimTimes | null,
  disputeTimeoutSecs: number,
): Scheduled | null {
  const live = warranty.status === WarrantyStatus.Active || warranty.status === WarrantyStatus.Claimed;
  if (!live) return null;
  if (shop.status === ShopStatus.Dormant && warranty.expiresAt >= shop.dormantAt) {
    return { action: "claimOrphan", dueAt: shop.dormantAt };
  }
  if (warranty.status === WarrantyStatus.Claimed) {
    if (!claim) return null;
    switch (claim.status) {
      case ClaimStatus.Pending:
        return { action: "settleUnanswered", dueAt: claim.filedAt + shop.responseSecs + 1 };
      case ClaimStatus.Rejected:
        return { action: "closeStale", dueAt: claim.disputeDeadline + 1 };
      case ClaimStatus.Accepted:
        return { action: "closeStale", dueAt: claim.repairDeadline + shop.disputeSecs + 1 };
      case ClaimStatus.Disputed:
        return { action: "settleStaleDispute", dueAt: claim.escalatedAt + disputeTimeoutSecs + 1 };
      default:
        return null;
    }
  }
  return { action: "releaseExpired", dueAt: warranty.expiresAt + 1 };
}

export function isDue(s: Scheduled | null, now: number): s is Scheduled {
  return s !== null && now >= s.dueAt;
}
