// Instructions behind the buttons on /w/[pda]. Every transaction is paid by the relayer and signed by a non-relayer key
// (the card holder, or for steps anyone may send, the visitor's throwaway key): the relayer refuses anything else.
import { hashJson, ix, type KekalProgram, type PermissionlessAction } from "@kekal/sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { WarrantyView } from "./view";

const pk = (s: string) => new PublicKey(s);

/** The fingerprint the program stores for a claim. The text itself stays with the buyer and the shop. */
export function evidenceHash(issueType: string, description: string): Uint8Array {
  return hashJson({ v: 1, issue: issueType, description: description.normalize("NFC").trim() });
}

export function holderTokenAccount(v: WarrantyView, holder: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(pk(v.shop.mint), holder, true);
}

/** First scan: the printed card key hands the warranty to a key only this phone knows. */
export async function activateIxs(p: KekalProgram, v: WarrantyView, card: PublicKey, next: PublicKey): Promise<TransactionInstruction[]> {
  return [await ix.transferHolder(p, { holder: card, warranty: pk(v.pda), newHolder: next })];
}

export async function fileClaimIxs(
  p: KekalProgram,
  v: WarrantyView,
  relayer: PublicKey,
  holder: PublicKey,
  hash: Uint8Array,
): Promise<TransactionInstruction[]> {
  return [
    await ix.fileClaim(p, {
      payer: relayer,
      holder,
      shop: pk(v.shop.address),
      warranty: pk(v.pda),
      claimIndex: v.warranty.claimCount,
      evidenceHash: hash,
    }),
  ];
}

function claimRef(v: WarrantyView) {
  if (!v.claim) throw new Error("no claim");
  return { shop: pk(v.shop.address), warranty: pk(v.pda), claim: pk(v.claim.address) };
}

export async function holderClaimIxs(
  p: KekalProgram,
  v: WarrantyView,
  holder: PublicKey,
  action: "confirmResolved" | "escalate",
): Promise<TransactionInstruction[]> {
  const a = { ...claimRef(v), holder };
  return [action === "confirmResolved" ? await ix.confirmResolved(p, a) : await ix.escalate(p, a)];
}

/** A step anyone may send once due. `caller` co-signs as an extra read-only account so the relayer sees a non-relayer signer. */
export async function settleIxs(
  p: KekalProgram,
  v: WarrantyView,
  action: PermissionlessAction,
  relayer: PublicKey,
  caller: PublicKey,
): Promise<TransactionInstruction[]> {
  const payout = { payer: relayer, shop: pk(v.shop.address), mint: pk(v.shop.mint), holder: pk(v.warranty.holder) };
  let built: TransactionInstruction;
  switch (action) {
    case "settleUnanswered":
      built = await ix.settleUnanswered(p, { ...claimRef(v), ...payout });
      break;
    case "settleStaleDispute":
      built = await ix.settleStaleDispute(p, { ...claimRef(v), ...payout });
      break;
    case "closeStale":
      built = await ix.closeStale(p, claimRef(v));
      break;
    case "declareDormant":
      built = await ix.declareDormant(p, { shop: pk(v.shop.address) });
      break;
    case "claimOrphan":
      built = await ix.claimOrphan(p, { ...payout, warranty: pk(v.pda), claim: v.claim?.open ? pk(v.claim.address) : null });
      break;
    case "releaseExpired":
      built = await ix.releaseExpired(p, { shop: pk(v.shop.address), warranty: pk(v.pda) });
      break;
  }
  built.keys.push({ pubkey: caller, isSigner: true, isWritable: false });
  return [built];
}

/** Sends paid-out money from the holder's account to any address, creating the receiving account if needed. */
export function sendIxs(v: WarrantyView, relayer: PublicKey, holder: PublicKey, to: PublicKey, amount: bigint): TransactionInstruction[] {
  const mint = pk(v.shop.mint);
  const dest = getAssociatedTokenAddressSync(mint, to, true);
  return [
    createAssociatedTokenAccountIdempotentInstruction(relayer, dest, to, mint),
    createTransferCheckedInstruction(holderTokenAccount(v, holder), mint, dest, holder, amount, v.decimals),
  ];
}
