// What /w/[pda] shows, computed from decoded accounts. Pure: no network, no clock reads, so tests can pin time.
import {
  ClaimStatus,
  ShopStatus,
  WarrantyStatus,
  isClaimOpen,
  scheduleShop,
  scheduleWarranty,
  statusKey,
  toHex,
  type ClaimAccount,
  type ConfigLimits,
  type Scheduled,
  type ShopAccount,
  type WarrantyAccount,
} from "@kekal/sdk";

export type HolderAction = "fileClaim" | "confirmResolved" | "escalate";

/** One transaction on the warranty's timeline. `events` are Kekal event names in log order. */
export interface TimelineEntry {
  signature: string;
  blockTime: number | null;
  failed: boolean;
  events: string[];
  explorer: string;
  /** Present on a ReservePaid entry: the paid amount (base units) and the claim status code that paid it. */
  paid?: { amount: string; claimStatus: number };
  /** Present on a HolderTransferred entry. */
  newHolder?: string;
}

/** Serialisable: crosses from the server page into the client holder panel. Amounts are base-unit strings. */
export interface WarrantyView {
  pda: string;
  programId: string;
  decimals: number;
  warranty: {
    id: string;
    holder: string;
    reserve: string;
    /** terms_hash as hex. */
    termsHash: string;
    issuedAt: number;
    expiresAt: number;
    status: number;
    statusKey: string;
    claimCount: number;
    lastClaimClosedAt: number;
  };
  shop: {
    address: string;
    owner: string;
    arbiter: string;
    mint: string;
    status: number;
    statusKey: string;
    lastSeen: number;
    dormantAt: number;
    responseSecs: number;
    repairSecs: number;
    disputeSecs: number;
    heartbeatSecs: number;
    graceSecs: number;
  };
  /** The latest claim (open or settled), or null when none was filed. */
  claim: null | {
    address: string;
    index: number;
    open: boolean;
    status: number;
    statusKey: string;
    filedAt: number;
    respondedAt: number;
    repairDeadline: number;
    disputeDeadline: number;
    escalatedAt: number;
  };
  limits: Pick<ConfigLimits, "disputeTimeoutSecs" | "claimCooldownSecs" | "maxClaimsPerWarranty">;
  /** The next step anyone may send, with the first second it is accepted. */
  next: Scheduled | null;
  terms: { json: string | null; matches: boolean | null };
  timeline: TimelineEntry[];
  /** First HolderTransferred on the timeline, when the timeline reaches back that far. */
  activatedAt: number | null;
  /** The payout, when the warranty paid out: amount and the status word that explains it. */
  payout: { amount: string; statusKey: string; at: number | null } | null;
  /** Chain clock minus server wall clock, in seconds, measured when the page was read. Deadlines use chain time. */
  clockSkew: number;
}

export interface ViewInput {
  pda: string;
  programId: string;
  decimals: number;
  warranty: WarrantyAccount;
  shop: ShopAccount & { address: string };
  claim: (ClaimAccount & { address: string }) | null;
  limits: ConfigLimits;
  terms: { json: string | null; matches: boolean | null };
  timeline: TimelineEntry[];
  clockSkew?: number;
}

export function buildView(i: ViewInput): WarrantyView {
  const { warranty: w, shop: s, claim: c } = i;
  const shopTimes = { ...s };
  const openClaim = c && w.status === WarrantyStatus.Claimed && isClaimOpen(c.status) ? c : null;
  const warrantyNext = scheduleWarranty(shopTimes, w, openClaim, i.limits.disputeTimeoutSecs);
  // An active shop past its heartbeat window must be declared dormant before the orphan payout can run.
  const shopNext = warrantyNext ? scheduleShop(shopTimes) : null;
  const next = shopNext && shopNext.dueAt < (warrantyNext?.dueAt ?? Infinity) ? shopNext : warrantyNext;
  const oldestFirst = [...i.timeline].reverse();
  const activation = oldestFirst.find((e) => !e.failed && e.events.includes("HolderTransferred"));
  const paidEntry = oldestFirst.find((e) => !e.failed && e.paid);
  return {
    pda: i.pda,
    programId: i.programId,
    decimals: i.decimals,
    warranty: {
      id: w.id.toString(),
      holder: w.holder.toBase58(),
      reserve: w.reserve.toString(),
      termsHash: toHex(w.termsHash),
      issuedAt: w.issuedAt,
      expiresAt: w.expiresAt,
      status: w.status,
      statusKey: statusKey.warranty(w.status),
      claimCount: w.claimCount,
      lastClaimClosedAt: w.lastClaimClosedAt,
    },
    shop: {
      address: s.address,
      owner: s.owner.toBase58(),
      arbiter: s.arbiter.toBase58(),
      mint: s.mint.toBase58(),
      status: s.status,
      statusKey: statusKey.shop(s.status),
      lastSeen: s.lastSeen,
      dormantAt: s.dormantAt,
      responseSecs: s.responseSecs,
      repairSecs: s.repairSecs,
      disputeSecs: s.disputeSecs,
      heartbeatSecs: s.heartbeatSecs,
      graceSecs: s.graceSecs,
    },
    claim: c
      ? {
          address: c.address,
          index: c.index,
          open: openClaim !== null,
          status: c.status,
          statusKey: statusKey.claim(c.status),
          filedAt: c.filedAt,
          respondedAt: c.respondedAt,
          repairDeadline: c.repairDeadline,
          disputeDeadline: c.disputeDeadline,
          escalatedAt: c.escalatedAt,
        }
      : null,
    limits: {
      disputeTimeoutSecs: i.limits.disputeTimeoutSecs,
      claimCooldownSecs: i.limits.claimCooldownSecs,
      maxClaimsPerWarranty: i.limits.maxClaimsPerWarranty,
    },
    next,
    terms: i.terms,
    timeline: i.timeline,
    activatedAt: activation?.blockTime ?? null,
    clockSkew: i.clockSkew ?? 0,
    payout:
      w.status === WarrantyStatus.PaidOut
        ? {
            amount: paidEntry?.paid?.amount ?? w.reserve.toString(),
            statusKey: statusKey.claim(paidEntry?.paid?.claimStatus ?? c?.status ?? ClaimStatus.PaidOrphan),
            at: paidEntry?.blockTime ?? null,
          }
        : null,
  };
}

/** What the card holder may do right now, mirroring the program's checks (holder.rs). */
export function holderActions(v: WarrantyView, now: number): HolderAction[] {
  const out: HolderAction[] = [];
  const c = v.claim;
  if (c?.open && c.status === ClaimStatus.Accepted) out.push("confirmResolved");
  if (c?.open) {
    const canEscalate =
      (c.status === ClaimStatus.Rejected && now <= c.disputeDeadline) ||
      (c.status === ClaimStatus.Accepted && now > c.repairDeadline && now <= c.repairDeadline + v.shop.disputeSecs);
    if (canEscalate) out.push("escalate");
  }
  const cooledDown = v.warranty.lastClaimClosedAt === 0 || now >= v.warranty.lastClaimClosedAt + v.limits.claimCooldownSecs;
  if (
    v.warranty.status === WarrantyStatus.Active &&
    v.shop.status === ShopStatus.Active &&
    now <= v.warranty.expiresAt &&
    v.warranty.claimCount < v.limits.maxClaimsPerWarranty &&
    cooledDown
  ) {
    out.push("fileClaim");
  }
  return out;
}

/** Whose key the visitor holds, compared with the holder on chain. */
export type KeyState = "none" | "holder" | "card-unactivated" | "card-taken";

/**
 * `stored` = key this browser saved after activating; `card` = key from the printed QR fragment.
 * A card key that no longer holds the warranty, with no matching stored key, means someone else activated it.
 */
export function keyState(holder: string, stored: string | null, card: string | null): KeyState {
  if (stored === holder) return "holder";
  if (card === holder) return "card-unactivated";
  if (card) return "card-taken";
  return "none";
}
