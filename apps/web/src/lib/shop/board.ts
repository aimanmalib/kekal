// What /kedai and /timbang show, computed from decoded accounts. Pure: no network, no clock reads. Serialisable:
// amounts and ids are decimal strings so the views cross from the API into the browser as JSON.
import { ClaimStatus, ShopStatus, WarrantyStatus, type ClaimAccount, type ConfigLimits, type ShopAccount, type WarrantyAccount } from "@kekal/sdk";

export interface ShopSummary {
  address: string;
  mint: string;
  arbiter: string;
  free: string;
  locked: string;
  status: number;
  lastSeen: number;
  dormantAt: number;
  /** The moment anyone may mark the shop silent if it sends no heartbeat before then. */
  silentAt: number;
  windows: { responseSecs: number; repairSecs: number; disputeSecs: number; heartbeatSecs: number; graceSecs: number };
  nextWarrantyId: string;
  activeWarranties: number;
  openClaims: number;
  issued: string;
  paidCount: string;
  paidAmount: string;
}

export interface WarrantyRow {
  address: string;
  id: string;
  holder: string;
  reserve: string;
  issuedAt: number;
  expiresAt: number;
  status: number;
}

export interface ClaimRow {
  address: string;
  warranty: string;
  warrantyId: string;
  index: number;
  status: number;
  filedAt: number;
  /** Pending: the shop must answer before this. Accepted: repair deadline. Rejected: the buyer may escalate until this. */
  deadline: number;
}

export interface ShopBoard {
  owner: string;
  programId: string;
  decimals: number;
  /** Latest confirmed block time; deadlines are judged on this clock. Null when unknown. */
  chainNow: number | null;
  limits: ConfigLimits | null;
  shop: ShopSummary | null;
  warranties: WarrantyRow[];
  claims: ClaimRow[];
}

export function shopSummary(address: string, s: ShopAccount): ShopSummary {
  return {
    address,
    mint: s.mint.toBase58(),
    arbiter: s.arbiter.toBase58(),
    free: s.freeBalance.toString(),
    locked: s.lockedBalance.toString(),
    status: s.status,
    lastSeen: s.lastSeen,
    dormantAt: s.dormantAt,
    silentAt: s.lastSeen + s.heartbeatSecs + s.graceSecs,
    windows: { responseSecs: s.responseSecs, repairSecs: s.repairSecs, disputeSecs: s.disputeSecs, heartbeatSecs: s.heartbeatSecs, graceSecs: s.graceSecs },
    nextWarrantyId: s.nextWarrantyId.toString(),
    activeWarranties: s.activeWarranties,
    openClaims: s.openClaims,
    issued: s.issued.toString(),
    paidCount: s.paidCount.toString(),
    paidAmount: s.paidAmount.toString(),
  };
}

export function warrantyRow(address: string, w: WarrantyAccount): WarrantyRow {
  return {
    address,
    id: w.id.toString(),
    holder: w.holder.toBase58(),
    reserve: w.reserve.toString(),
    issuedAt: w.issuedAt,
    expiresAt: w.expiresAt,
    status: w.status,
  };
}

/** Deadline that matters for the claim's current state; 0 when nothing is running. */
export function claimDeadline(c: Pick<ClaimAccount, "status" | "filedAt" | "repairDeadline" | "disputeDeadline">, shop: Pick<ShopAccount, "responseSecs">): number {
  if (c.status === ClaimStatus.Pending) return c.filedAt + shop.responseSecs;
  if (c.status === ClaimStatus.Accepted) return c.repairDeadline;
  if (c.status === ClaimStatus.Rejected) return c.disputeDeadline;
  return 0;
}

export function claimRow(address: string, c: ClaimAccount, w: Pick<WarrantyAccount, "id">, shop: Pick<ShopAccount, "responseSecs">): ClaimRow {
  return {
    address,
    warranty: c.warranty.toBase58(),
    warrantyId: w.id.toString(),
    index: c.index,
    status: c.status,
    filedAt: c.filedAt,
    deadline: claimDeadline(c, shop),
  };
}

/** Newest card first. */
export function sortWarranties(rows: WarrantyRow[]): WarrantyRow[] {
  return [...rows].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : BigInt(b.id) < BigInt(a.id) ? -1 : 0));
}

export type ShopAction = "respond";

/** The shop may answer a pending claim until its response window closes (chain clock). */
export function canRespond(c: ClaimRow, chainNow: number): boolean {
  return c.status === ClaimStatus.Pending && chainNow < c.deadline;
}

export function isShopActive(s: ShopSummary): boolean {
  return s.status === ShopStatus.Active;
}

export const LIVE_WARRANTY: ReadonlySet<number> = new Set([WarrantyStatus.Active, WarrantyStatus.Claimed]);

/** A disputed claim waiting for its arbiter. */
export interface DisputeRow {
  claim: string;
  index: number;
  warranty: string;
  warrantyId: string;
  shop: string;
  shopOwner: string;
  holder: string;
  mint: string;
  reserve: string;
  escalatedAt: number;
  /** After this anyone may settle the dispute for the buyer (dispute timeout). */
  staleAt: number;
}

export interface ArbiterBoard {
  arbiter: string;
  programId: string;
  decimals: number;
  chainNow: number | null;
  disputes: DisputeRow[];
}

export function disputeRow(
  claim: { address: string; account: ClaimAccount },
  warranty: { address: string; account: WarrantyAccount },
  shop: { address: string; account: ShopAccount },
  disputeTimeoutSecs: number,
): DisputeRow {
  return {
    claim: claim.address,
    index: claim.account.index,
    warranty: warranty.address,
    warrantyId: warranty.account.id.toString(),
    shop: shop.address,
    shopOwner: shop.account.owner.toBase58(),
    holder: warranty.account.holder.toBase58(),
    mint: shop.account.mint.toBase58(),
    reserve: warranty.account.reserve.toString(),
    escalatedAt: claim.account.escalatedAt,
    staleAt: claim.account.escalatedAt + disputeTimeoutSecs,
  };
}

/** Live numbers for the home page. Amounts are base-unit strings. */
export interface ProgramStats {
  shops: number;
  activeWarranties: number;
  locked: string;
  paidClaims: string;
}

export function programStats(shops: ShopAccount[], warranties: Pick<WarrantyAccount, "status">[]): ProgramStats {
  return {
    shops: shops.length,
    activeWarranties: warranties.filter((w) => LIVE_WARRANTY.has(w.status)).length,
    locked: shops.reduce((n, s) => n + s.lockedBalance, 0n).toString(),
    paidClaims: shops.reduce((n, s) => n + s.paidCount, 0n).toString(),
  };
}
