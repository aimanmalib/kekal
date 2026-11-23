// Decoded-account fixtures for keeper tests. Times are arbitrary unix seconds.
import { ClaimStatus, ShopStatus, WarrantyStatus, type ClaimAccount, type ShopAccount, type WarrantyAccount } from "@kekal/sdk";
import { Keypair, type PublicKey } from "@solana/web3.js";
import type { Keyed, LiveWarranty } from "../src/plan";

const key = () => Keypair.generate().publicKey;
const zero32 = new Uint8Array(32);

export function shop(owner: PublicKey, over: Partial<ShopAccount> = {}): Keyed<ShopAccount> {
  return {
    key: key(),
    account: {
      owner,
      mint: key(),
      vault: key(),
      arbiter: key(),
      freeBalance: 0n,
      lockedBalance: 0n,
      responseSecs: 60,
      repairSecs: 120,
      disputeSecs: 60,
      heartbeatSecs: 120,
      graceSecs: 60,
      lastSeen: 1_000,
      status: ShopStatus.Active,
      dormantAt: 0,
      nextWarrantyId: 1n,
      activeWarranties: 1,
      openClaims: 0,
      issued: 1n,
      paidCount: 0n,
      paidAmount: 0n,
      releasedAmount: 0n,
      flags: 0,
      profileHash: zero32,
      createdAt: 900,
      ...over,
    },
  };
}

export function warranty(shopKey: PublicKey, over: Partial<WarrantyAccount> = {}, claim: Partial<ClaimAccount> | null = null): LiveWarranty {
  const w = {
    key: key(),
    account: {
      shop: shopKey,
      id: 0n,
      holder: key(),
      reserve: 25n,
      termsHash: zero32,
      productHash: zero32,
      issuedAt: 1_000,
      expiresAt: 100_000,
      status: claim ? WarrantyStatus.Claimed : WarrantyStatus.Active,
      claimCount: claim ? 1 : 0,
      openClaim: 0,
      lastClaimClosedAt: 0,
      ...over,
    },
  };
  if (!claim) return { ...w, claim: null };
  return {
    ...w,
    claim: {
      key: key(),
      account: {
        warranty: w.key,
        index: 0,
        evidenceHash: zero32,
        filedAt: 1_100,
        status: ClaimStatus.Pending,
        responseHash: zero32,
        respondedAt: 0,
        repairDeadline: 0,
        disputeDeadline: 0,
        escalatedAt: 0,
        attestVerdict: 0,
        attestAt: 0,
        rentPayer: key(),
        ...claim,
      },
    },
  };
}
