import BN from "bn.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { ConfigLimits } from "./accounts";
import { claimPda, configPda, shopPda, vaultPda, warrantyPda } from "./pda";
import type { KekalProgram } from "./program";

/** Builders for all 20 instructions. Every PDA is derived here, never resolved by Anchor, so the
 * program's seed checks verify the SDK on every call. */

export const ALLOWED_MINT_SLOTS = 4;

export interface ConfigParams {
  defaultArbiter: PublicKey;
  assessor: PublicKey;
  limits: ConfigLimits;
  /** Up to four mints; empty slots are filled with the all-zero key. */
  allowedMints: PublicKey[];
  paused: boolean;
}
export interface ShopWindows {
  responseSecs: number;
  repairSecs: number;
  disputeSecs: number;
  heartbeatSecs: number;
  graceSecs: number;
}
export interface IssueParams {
  holder: PublicKey;
  reserve: bigint;
  termSecs: number;
  termsHash: Uint8Array;
  productHash: Uint8Array;
}

const bn = (v: bigint | number) => new BN(v.toString());
const bytes32 = (b: Uint8Array) => {
  if (b.length !== 32) throw new RangeError("expected 32 bytes");
  return Array.from(b);
};

function configArgs(p: ConfigParams) {
  if (p.allowedMints.length > ALLOWED_MINT_SLOTS) throw new RangeError("too many mints");
  const limits = Object.fromEntries(
    Object.entries(p.limits).map(([k, v]) => [k, k === "maxClaimsPerWarranty" ? v : bn(v)]),
  );
  const mints = [...p.allowedMints];
  while (mints.length < ALLOWED_MINT_SLOTS) mints.push(PublicKey.default);
  return { defaultArbiter: p.defaultArbiter, assessor: p.assessor, limits, allowedMints: mints, paused: p.paused };
}

function windowArgs(w: ShopWindows) {
  return {
    responseSecs: bn(w.responseSecs),
    repairSecs: bn(w.repairSecs),
    disputeSecs: bn(w.disputeSecs),
    heartbeatSecs: bn(w.heartbeatSecs),
    graceSecs: bn(w.graceSecs),
  };
}

/** Accounts of the shared payout group (instructions 14, 15, 17, 19). */
export interface PayoutInput {
  payer: PublicKey;
  shop: PublicKey;
  mint: PublicKey;
  holder: PublicKey;
}
function payoutAccounts(program: KekalProgram, a: PayoutInput) {
  return {
    payer: a.payer,
    mint: a.mint,
    vault: vaultPda(program.programId, a.shop),
    holder: a.holder,
    holderToken: getAssociatedTokenAddressSync(a.mint, a.holder, true),
  };
}

export interface ClaimRef {
  shop: PublicKey;
  warranty: PublicKey;
  claim: PublicKey;
}

type Ix = Promise<TransactionInstruction>;
type Accounts = Record<string, PublicKey | null | Record<string, PublicKey>>;

function call(p: KekalProgram, name: string, args: unknown[], accounts: Accounts | ClaimRef): Ix {
  const method = p.methods[name];
  if (!method) throw new Error(`IDL has no instruction ${name}`);
  // `null` marks an absent optional account (claim_orphan without an open claim).
  return method(...args).accountsPartial(accounts as never).instruction();
}

export const ix = {
  initConfig: (p: KekalProgram, a: { admin: PublicKey; params: ConfigParams }): Ix =>
    call(p, "initConfig", [configArgs(a.params)], { admin: a.admin, config: configPda(p.programId) }),

  setConfig: (p: KekalProgram, a: { admin: PublicKey; params: ConfigParams }): Ix =>
    call(p, "setConfig", [configArgs(a.params)], { admin: a.admin, config: configPda(p.programId) }),

  createShop: (
    p: KekalProgram,
    a: { owner: PublicKey; mint: PublicKey; windows: ShopWindows; arbiter: PublicKey | null; profileHash: Uint8Array },
  ): Ix => {
    const shop = shopPda(p.programId, a.owner);
    return call(p, "createShop", [windowArgs(a.windows), a.arbiter, bytes32(a.profileHash)], {
        owner: a.owner,
        config: configPda(p.programId),
        mint: a.mint,
        shop,
        vault: vaultPda(p.programId, shop),
      });
  },

  updateShopProfile: (p: KekalProgram, a: { owner: PublicKey; profileHash: Uint8Array }): Ix =>
    call(p, "updateShopProfile", [bytes32(a.profileHash)], { owner: a.owner, shop: shopPda(p.programId, a.owner) }),

  deposit: (p: KekalProgram, a: { owner: PublicKey; mint: PublicKey; ownerToken: PublicKey; amount: bigint }): Ix =>
    moveFunds(p, "deposit", a),

  withdraw: (p: KekalProgram, a: { owner: PublicKey; mint: PublicKey; ownerToken: PublicKey; amount: bigint }): Ix =>
    moveFunds(p, "withdraw", a),

  /** `warrantyId` must equal `shop.next_warranty_id` at execution time. */
  issueWarranty: (p: KekalProgram, a: { owner: PublicKey; warrantyId: bigint; params: IssueParams }): Ix => {
    const shop = shopPda(p.programId, a.owner);
    return call(p, "issueWarranty", [{
        holder: a.params.holder,
        reserve: bn(a.params.reserve),
        termSecs: bn(a.params.termSecs),
        termsHash: bytes32(a.params.termsHash),
        productHash: bytes32(a.params.productHash),
      }], {
        owner: a.owner,
        config: configPda(p.programId),
        shop,
        warranty: warrantyPda(p.programId, shop, a.warrantyId),
      });
  },

  heartbeat: (p: KekalProgram, a: { owner: PublicKey }): Ix =>
    call(p, "heartbeat", [], { owner: a.owner, shop: shopPda(p.programId, a.owner) }),

  transferHolder: (p: KekalProgram, a: { holder: PublicKey; warranty: PublicKey; newHolder: PublicKey }): Ix =>
    call(p, "transferHolder", [a.newHolder], { holder: a.holder, warranty: a.warranty }),

  /** `claimIndex` must equal `warranty.claim_count` at execution time. */
  fileClaim: (
    p: KekalProgram,
    a: { payer: PublicKey; holder: PublicKey; shop: PublicKey; warranty: PublicKey; claimIndex: number; evidenceHash: Uint8Array },
  ): Ix =>
    call(p, "fileClaim", [bytes32(a.evidenceHash)], {
        payer: a.payer,
        holder: a.holder,
        config: configPda(p.programId),
        shop: a.shop,
        warranty: a.warranty,
        claim: claimPda(p.programId, a.warranty, a.claimIndex),
      }),

  respondClaim: (
    p: KekalProgram,
    a: { owner: PublicKey; warranty: PublicKey; claim: PublicKey; accept: boolean; responseHash: Uint8Array },
  ): Ix =>
    call(p, "respondClaim", [a.accept, bytes32(a.responseHash)], { owner: a.owner, shop: shopPda(p.programId, a.owner), warranty: a.warranty, claim: a.claim }),

  confirmResolved: (p: KekalProgram, a: ClaimRef & { holder: PublicKey }): Ix =>
    call(p, "confirmResolved", [], a),

  escalate: (p: KekalProgram, a: ClaimRef & { holder: PublicKey }): Ix =>
    call(p, "escalate", [], a),

  resolveDispute: (p: KekalProgram, a: ClaimRef & PayoutInput & { arbiter: PublicKey; buyerWins: boolean }): Ix =>
    call(p, "resolveDispute", [a.buyerWins], {
        arbiter: a.arbiter,
        shop: a.shop,
        warranty: a.warranty,
        claim: a.claim,
        payout: payoutAccounts(p, a),
      }),

  settleUnanswered: (p: KekalProgram, a: ClaimRef & PayoutInput): Ix =>
    payClaim(p, "settleUnanswered", a),

  closeStale: (p: KekalProgram, a: ClaimRef): Ix => call(p, "closeStale", [], a),

  settleStaleDispute: (p: KekalProgram, a: ClaimRef & PayoutInput): Ix => payClaim(p, "settleStaleDispute", a),

  declareDormant: (p: KekalProgram, a: { shop: PublicKey }): Ix =>
    call(p, "declareDormant", [], a),

  /** `claim` = the open claim when the warranty is Claimed, otherwise null. */
  claimOrphan: (p: KekalProgram, a: PayoutInput & { warranty: PublicKey; claim: PublicKey | null }): Ix =>
    call(p, "claimOrphan", [], { shop: a.shop, warranty: a.warranty, claim: a.claim, payout: payoutAccounts(p, a) }),

  releaseExpired: (p: KekalProgram, a: { shop: PublicKey; warranty: PublicKey }): Ix =>
    call(p, "releaseExpired", [], a),
};

function moveFunds(
  p: KekalProgram,
  name: "deposit" | "withdraw",
  a: { owner: PublicKey; mint: PublicKey; ownerToken: PublicKey; amount: bigint },
): Ix {
  const shop = shopPda(p.programId, a.owner);
  return call(p, name, [bn(a.amount)], {
      owner: a.owner,
      shop,
      mint: a.mint,
      vault: vaultPda(p.programId, shop),
      ownerToken: a.ownerToken,
    });
}

function payClaim(p: KekalProgram, name: "settleUnanswered" | "settleStaleDispute", a: ClaimRef & PayoutInput): Ix {
  return call(p, name, [], {
      config: configPda(p.programId),
      shop: a.shop,
      warranty: a.warranty,
      claim: a.claim,
      payout: payoutAccounts(p, a),
    });
}
