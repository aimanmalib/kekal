// Instructions behind the buttons on /kedai and /timbang. The connected wallet signs and pays; nothing here touches the
// network, so the builders are tested offline.
import { hashJson, ix, shopPda, type KekalProgram } from "@kekal/sdk";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { DisputeRow } from "./board";
import { shopProductHash, shopTermsJson, termsHashOf, type ShopTermsInput } from "./terms";

const pk = (s: string) => new PublicKey(s);

export function ownerTokenAccount(mint: string, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(pk(mint), owner, true);
}

export async function openShopIxs(p: KekalProgram, owner: PublicKey, mint: string, windows: Parameters<typeof ix.createShop>[1]["windows"]): Promise<TransactionInstruction[]> {
  return [await ix.createShop(p, { owner, mint: pk(mint), windows, arbiter: null, profileHash: hashJson({ v: 1, owner: owner.toBase58() }) })];
}

export async function depositIxs(p: KekalProgram, owner: PublicKey, mint: string, amount: bigint): Promise<TransactionInstruction[]> {
  return [await ix.deposit(p, { owner, mint: pk(mint), ownerToken: ownerTokenAccount(mint, owner), amount })];
}

/** Withdraw creates the owner's token account first if it is missing (idempotent, the owner pays). */
export async function withdrawIxs(p: KekalProgram, owner: PublicKey, mint: string, amount: bigint): Promise<TransactionInstruction[]> {
  const ownerToken = ownerTokenAccount(mint, owner);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, ownerToken, owner, pk(mint)),
    await ix.withdraw(p, { owner, mint: pk(mint), ownerToken, amount }),
  ];
}

export async function heartbeatIxs(p: KekalProgram, owner: PublicKey): Promise<TransactionInstruction[]> {
  return [await ix.heartbeat(p, { owner })];
}

export interface IssueInput extends ShopTermsInput {
  /** The card key: a fresh key the seller's browser made for the printed card. */
  holder: PublicKey;
  warrantyId: bigint;
}

/** Issue with a heartbeat in the same transaction (issuing proves the shop is alive). Returns the terms text too. */
export async function issueIxs(p: KekalProgram, owner: PublicKey, i: IssueInput): Promise<{ ixs: TransactionInstruction[]; termsJson: string }> {
  const termsJson = shopTermsJson(i);
  const shop = shopPda(p.programId, owner);
  const issue = await ix.issueWarranty(p, {
    owner,
    warrantyId: i.warrantyId,
    params: { holder: i.holder, reserve: BigInt(i.reserve), termSecs: i.termSecs, termsHash: termsHashOf(termsJson), productHash: shopProductHash(shop, i) },
  });
  return { ixs: [await ix.heartbeat(p, { owner }), issue], termsJson };
}

/** The fingerprint of the shop's answer; the reason text itself stays with the shop. */
export function responseHash(accept: boolean, reason: string): Uint8Array {
  return hashJson({ v: 1, accept, reason: reason.normalize("NFC").trim() });
}

export async function respondIxs(
  p: KekalProgram,
  owner: PublicKey,
  a: { warranty: string; claim: string; accept: boolean; reason: string },
): Promise<TransactionInstruction[]> {
  return [
    await ix.respondClaim(p, { owner, warranty: pk(a.warranty), claim: pk(a.claim), accept: a.accept, responseHash: responseHash(a.accept, a.reason) }),
  ];
}

/** The arbiter's wallet pays any account rent of the payout (the buyer's token account). */
export async function resolveIxs(p: KekalProgram, arbiter: PublicKey, d: DisputeRow, buyerWins: boolean): Promise<TransactionInstruction[]> {
  return [
    await ix.resolveDispute(p, {
      payer: arbiter,
      arbiter,
      shop: pk(d.shop),
      mint: pk(d.mint),
      holder: pk(d.holder),
      warranty: pk(d.warranty),
      claim: pk(d.claim),
      buyerWins,
    }),
  ];
}
