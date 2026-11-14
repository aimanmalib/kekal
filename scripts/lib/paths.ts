import {
  ClaimStatus,
  claimPda,
  fetchClaim,
  fetchShop,
  fetchWarranty,
  hashJson,
  ix,
  scheduleShop,
  scheduleWarranty,
  WarrantyStatus,
  type ClaimAccount,
} from "@kekal/sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { send, waitForChainTime } from "./chain";
import type { Env, Issued, Log } from "./setup";

/** Paths A to E (PRD §2.2): each ends in a checked final state. */

async function mustClaim(env: Env, claim: PublicKey): Promise<ClaimAccount> {
  const c = await fetchClaim(env.program, claim);
  if (!c) throw new Error(`claim ${claim.toBase58()} missing`);
  return c;
}

async function expectState(env: Env, w: Issued, warrantyStatus: number, claim?: { key: PublicKey; status: number }) {
  const warranty = await fetchWarranty(env.program, w.warranty);
  if (warranty?.status !== warrantyStatus) {
    throw new Error(`warranty ${w.warranty.toBase58()} status ${warranty?.status}, expected ${warrantyStatus}`);
  }
  if (claim) {
    const c = await mustClaim(env, claim.key);
    if (c.status !== claim.status) throw new Error(`claim status ${c.status}, expected ${claim.status}`);
  }
}

/** The holder's token account must hold exactly one reserve. */
async function expectPaid(env: Env, w: Issued) {
  const ata = getAssociatedTokenAddressSync(env.mint, w.holder.publicKey, true);
  const bal = await env.conn.getTokenAccountBalance(ata);
  if (bal.value.amount !== env.c.lifecycle.reserve) {
    throw new Error(`holder received ${bal.value.amount}, expected ${env.c.lifecycle.reserve}`);
  }
}

async function file(env: Env, w: Issued, log: Log): Promise<PublicKey> {
  const state = await fetchWarranty(env.program, w.warranty);
  if (!state) throw new Error("warranty missing");
  const claim = claimPda(env.program.programId, w.warranty, state.claimCount);
  const built = await ix.fileClaim(env.program, {
    payer: env.roles.feePayer.publicKey,
    holder: w.holder.publicKey,
    shop: w.shop,
    warranty: w.warranty,
    claimIndex: state.claimCount,
    evidenceHash: hashJson({ issue: "does not power on", warranty: w.warranty.toBase58() }),
  });
  log("file_claim", await send(env.conn, env.roles.feePayer, [built], [w.holder]));
  return claim;
}

async function respond(env: Env, w: Issued, claim: PublicKey, accept: boolean, log: Log) {
  const built = await ix.respondClaim(env.program, {
    owner: w.owner.publicKey,
    warranty: w.warranty,
    claim,
    accept,
    responseHash: hashJson({ accept, note: accept ? "repair booked" : "outside cover" }),
  });
  log("respond_claim", await send(env.conn, w.owner, [built]));
}

const payout = (env: Env, w: Issued) => ({
  payer: env.roles.feePayer.publicKey,
  shop: w.shop,
  mint: env.mint,
  holder: w.holder.publicKey,
});

/** A: claim → shop accepts → holder confirms the repair. */
export async function pathA(env: Env, w: Issued, log: Log) {
  const claim = await file(env, w, log);
  await respond(env, w, claim, true, log);
  const built = await ix.confirmResolved(env.program, { holder: w.holder.publicKey, shop: w.shop, warranty: w.warranty, claim });
  log("confirm_resolved", await send(env.conn, env.roles.feePayer, [built], [w.holder]));
  await expectState(env, w, WarrantyStatus.Active, { key: claim, status: ClaimStatus.Resolved });
}

/** B: claim → shop silent → anyone settles after the response window. */
export async function pathB(env: Env, w: Issued, log: Log) {
  const claim = await file(env, w, log);
  const [shop, warranty, c] = await Promise.all([fetchShop(env.program, w.shop), fetchWarranty(env.program, w.warranty), mustClaim(env, claim)]);
  const due = scheduleWarranty(shop!, warranty!, c, 0);
  if (due?.action !== "settleUnanswered") throw new Error(`path B: unexpected schedule ${JSON.stringify(due)}`);
  await waitForChainTime(env.conn, due.dueAt, env.c.lifecycle.timeoutSecs);
  const built = await ix.settleUnanswered(env.program, { ...payout(env, w), warranty: w.warranty, claim });
  log("settle_unanswered", await send(env.conn, env.roles.feePayer, [built]));
  await expectState(env, w, WarrantyStatus.PaidOut, { key: claim, status: ClaimStatus.PaidTimeout });
  await expectPaid(env, w);
}

/** C: shop stops its heartbeat → anyone declares it dormant → the holder is paid as an orphan. */
export async function pathC(env: Env, w: Issued, log: Log) {
  const shop = await fetchShop(env.program, w.shop);
  const due = scheduleShop(shop!);
  if (!due) throw new Error("path C: shop already dormant");
  await waitForChainTime(env.conn, due.dueAt, env.c.lifecycle.timeoutSecs);
  log("declare_dormant", await send(env.conn, env.roles.feePayer, [await ix.declareDormant(env.program, { shop: w.shop })]));
  const built = await ix.claimOrphan(env.program, { ...payout(env, w), warranty: w.warranty, claim: null });
  log("claim_orphan", await send(env.conn, env.roles.feePayer, [built]));
  await expectState(env, w, WarrantyStatus.PaidOut);
  await expectPaid(env, w);
}

/** D: warranty expires without a claim → anyone returns the reserve to the shop. */
export async function pathD(env: Env, w: Issued, log: Log) {
  const [shop, warranty] = await Promise.all([fetchShop(env.program, w.shop), fetchWarranty(env.program, w.warranty)]);
  const due = scheduleWarranty(shop!, warranty!, null, 0);
  if (due?.action !== "releaseExpired") throw new Error(`path D: unexpected schedule ${JSON.stringify(due)}`);
  await waitForChainTime(env.conn, due.dueAt, env.c.lifecycle.timeoutSecs);
  const built = await ix.releaseExpired(env.program, { shop: w.shop, warranty: w.warranty });
  log("release_expired", await send(env.conn, env.roles.feePayer, [built]));
  await expectState(env, w, WarrantyStatus.Released);
}

/** E: shop rejects → holder escalates → the arbiter rules for the buyer. */
export async function pathE(env: Env, w: Issued, log: Log) {
  const claim = await file(env, w, log);
  await respond(env, w, claim, false, log);
  const esc = await ix.escalate(env.program, { holder: w.holder.publicKey, shop: w.shop, warranty: w.warranty, claim });
  log("escalate", await send(env.conn, env.roles.feePayer, [esc], [w.holder]));
  const built = await ix.resolveDispute(env.program, {
    ...payout(env, w),
    arbiter: env.roles.arbiter.publicKey,
    buyerWins: true,
    warranty: w.warranty,
    claim,
  });
  log("resolve_dispute", await send(env.conn, env.roles.feePayer, [built], [env.roles.arbiter]));
  await expectState(env, w, WarrantyStatus.PaidOut, { key: claim, status: ClaimStatus.PaidArbiter });
  await expectPaid(env, w);
}
