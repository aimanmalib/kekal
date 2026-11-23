// A decoded warranty, shop and claim with fixed times, for the /w/[pda] tests. Shapes only: no owner data.
import { ClaimStatus, ShopStatus, WarrantyStatus, type ClaimAccount, type ConfigLimits, type ShopAccount, type WarrantyAccount } from "@kekal/sdk";
import { Keypair } from "@solana/web3.js";
import { buildView, type TimelineEntry, type ViewInput } from "../src/lib/warranty/view";

export const T0 = 1_800_000_000;
export const keys = {
  pda: Keypair.generate().publicKey,
  shop: Keypair.generate().publicKey,
  owner: Keypair.generate().publicKey,
  holder: Keypair.generate(),
  mint: Keypair.generate().publicKey,
  claim: Keypair.generate().publicKey,
  program: Keypair.generate().publicKey,
};

export const limits: ConfigLimits = {
  minResponseSecs: 1, maxResponseSecs: 1e6, minRepairSecs: 1, maxRepairSecs: 1e6, minDisputeSecs: 1, maxDisputeSecs: 1e6,
  minHeartbeatSecs: 1, maxHeartbeatSecs: 1e7, maxGraceSecs: 1e6, minTermSecs: 1, maxTermSecs: 1e8,
  disputeTimeoutSecs: 600, claimCooldownSecs: 100, maxClaimsPerWarranty: 3,
};

export function warrantyAcc(over: Partial<WarrantyAccount> = {}): WarrantyAccount {
  return {
    shop: keys.shop, id: 4n, holder: keys.holder.publicKey, reserve: 25_000_000n, termsHash: new Uint8Array(32),
    productHash: new Uint8Array(32), issuedAt: T0, expiresAt: T0 + 86_400 * 365, status: WarrantyStatus.Active,
    claimCount: 0, openClaim: 0, lastClaimClosedAt: 0, ...over,
  };
}

export function shopAcc(over: Partial<ShopAccount> = {}): ShopAccount & { address: string } {
  return {
    owner: keys.owner, mint: keys.mint, vault: keys.shop, arbiter: keys.owner, freeBalance: 0n, lockedBalance: 25_000_000n,
    responseSecs: 60, repairSecs: 120, disputeSecs: 60, heartbeatSecs: 120, graceSecs: 60, lastSeen: T0, status: ShopStatus.Active,
    dormantAt: 0, nextWarrantyId: 5n, activeWarranties: 1, openClaims: 0, issued: 5n, paidCount: 0n, paidAmount: 0n,
    releasedAmount: 0n, flags: 0, profileHash: new Uint8Array(32), createdAt: T0, address: keys.shop.toBase58(), ...over,
  };
}

export function claimAcc(over: Partial<ClaimAccount> = {}): ClaimAccount & { address: string } {
  return {
    warranty: keys.pda, index: 0, evidenceHash: new Uint8Array(32), filedAt: T0 + 10, status: ClaimStatus.Pending,
    responseHash: new Uint8Array(32), respondedAt: 0, repairDeadline: 0, disputeDeadline: 0, escalatedAt: 0, attestVerdict: 0,
    attestAt: 0, rentPayer: keys.owner, address: keys.claim.toBase58(), ...over,
  };
}

export const entry = (over: Partial<TimelineEntry> & { events: string[] }): TimelineEntry => ({
  signature: `sig${Math.random().toString(36).slice(2)}`, blockTime: T0, failed: false, explorer: "https://explorer.example/tx/x", ...over,
});

export function view(over: Partial<ViewInput> = {}) {
  return buildView({
    pda: keys.pda.toBase58(),
    programId: keys.program.toBase58(),
    decimals: 6,
    warranty: warrantyAcc(),
    shop: shopAcc(),
    claim: null,
    limits,
    terms: { json: null, matches: null },
    timeline: [entry({ events: ["HeartbeatSent", "WarrantyIssued"] })],
    ...over,
  });
}
