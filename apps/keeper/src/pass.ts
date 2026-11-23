// One keeper pass (PRD 4.4): heartbeat the demo shops, declare lapsed shops dormant, then send every due
// permissionless instruction. Reads, clock and sending are injected so tests need no cluster.
import { ix, ShopStatus, type KekalProgram, type ShopAccount } from "@kekal/sdk";
import { programErrorName } from "@kekal/server";
import type { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { dueDormant, dueWarrantyActions, heartbeatDue, type Action, type Keyed, type LiveWarranty } from "./plan";

export interface ChainReader {
  shops(): Promise<Keyed<ShopAccount>[]>;
  liveWarranties(): Promise<LiveWarranty[]>;
  /** `Config.limits.dispute_timeout_secs` on chain. */
  disputeTimeoutSecs(): Promise<number>;
  /** Cluster clock (unix seconds), the value the program compares against. */
  clock(): Promise<number>;
}

export interface PassDeps {
  program: KekalProgram;
  reader: ChainReader;
  send: (feePayer: Keypair, ixs: TransactionInstruction[]) => Promise<string>;
  feePayer: Keypair;
  heartbeatOwners: Keypair[];
  /** Owner key (base58) → cluster time of this process's last heartbeat. Kept between passes by the caller. */
  lastHeartbeat: Map<string, number>;
  heartbeatEverySecs: number;
  maxActions: number;
  log: (line: string) => void;
}

export interface Outcome {
  step: string;
  target: string;
  signature?: string;
  /** Program error name or message. */
  error?: string;
  /** The account had already moved on (another sender won the race): not a failure. */
  stale?: boolean;
}

export interface PassReport {
  clock: number;
  outcomes: Outcome[];
  failed: number;
}

/** Program errors that mean "someone already did this" or "the state changed under us". */
const STALE = new Set([
  "WarrantyNotActive",
  "InvalidClaimState",
  "ShopDormant",
  "ShopNotDormant",
  "ShopStillActive",
  "WindowStillOpen",
  "WarrantyNotExpired",
]);

async function attempt(deps: PassDeps, step: string, target: PublicKey, payer: Keypair, build: () => Promise<TransactionInstruction>) {
  try {
    const signature = await deps.send(payer, [await build()]);
    deps.log(`${step} ${target.toBase58()} ${signature}`);
    return { step, target: target.toBase58(), signature };
  } catch (e) {
    const name = programErrorName(e);
    const stale = name !== null && STALE.has(name);
    const error = name ?? (e as Error).message.slice(0, 200);
    deps.log(`${step} ${target.toBase58()} ${stale ? "skipped" : "failed"}: ${error}`);
    return { step, target: target.toBase58(), error, stale };
  }
}

function actionIx(p: KekalProgram, a: Action, shops: Map<string, ShopAccount>, w: LiveWarranty, payer: PublicKey) {
  const shop = shops.get(a.shop.toBase58())!;
  const payout = { payer, shop: a.shop, mint: shop.mint, holder: w.account.holder };
  switch (a.action) {
    case "settleUnanswered":
      return ix.settleUnanswered(p, { ...payout, warranty: a.warranty, claim: a.claim! });
    case "settleStaleDispute":
      return ix.settleStaleDispute(p, { ...payout, warranty: a.warranty, claim: a.claim! });
    case "closeStale":
      return ix.closeStale(p, { shop: a.shop, warranty: a.warranty, claim: a.claim! });
    case "claimOrphan":
      return ix.claimOrphan(p, { ...payout, warranty: a.warranty, claim: a.claim });
    case "releaseExpired":
      return ix.releaseExpired(p, { shop: a.shop, warranty: a.warranty });
  }
}

export async function runPass(deps: PassDeps): Promise<PassReport> {
  const { program, reader } = deps;
  const outcomes: Outcome[] = [];
  let clock = await reader.clock();

  // 1. Heartbeats first: a late heartbeat still counts until someone declares the shop dormant.
  const shops = await reader.shops();
  const byOwner = new Map(shops.map((s) => [s.account.owner.toBase58(), s]));
  for (const owner of deps.heartbeatOwners) {
    const id = owner.publicKey.toBase58();
    const shop = byOwner.get(id);
    if (!shop || shop.account.status !== ShopStatus.Active || !heartbeatDue(deps.lastHeartbeat.get(id), clock, deps.heartbeatEverySecs)) continue;
    const o = await attempt(deps, "heartbeat", shop.key, owner, () => ix.heartbeat(program, { owner: owner.publicKey }));
    if (o.signature) deps.lastHeartbeat.set(id, clock);
    outcomes.push(o);
  }

  // 2. Dormancy before any release (ADR 0005), so a silent shop's reserves go to holders, not back to the shop.
  const heartbeated = new Set(outcomes.filter((o) => o.signature).map((o) => o.target));
  for (const shop of dueDormant(shops, clock).filter((k) => !heartbeated.has(k.toBase58()))) {
    outcomes.push(await attempt(deps, "declareDormant", shop, deps.feePayer, () => ix.declareDormant(program, { shop })));
  }

  // 3. Warranty steps on fresh state (dormancy changes what is due).
  const [freshShops, warranties, disputeTimeout] = await Promise.all([reader.shops(), reader.liveWarranties(), reader.disputeTimeoutSecs()]);
  clock = await reader.clock();
  const shopMap = new Map(freshShops.map((s) => [s.key.toBase58(), s.account]));
  const byKey = new Map(warranties.map((w) => [w.key.toBase58(), w]));
  for (const a of dueWarrantyActions(shopMap, warranties, clock, disputeTimeout, deps.maxActions)) {
    const w = byKey.get(a.warranty.toBase58())!;
    outcomes.push(await attempt(deps, a.action, a.warranty, deps.feePayer, () => actionIx(program, a, shopMap, w, deps.feePayer.publicKey)));
  }
  return { clock, outcomes, failed: outcomes.filter((o) => o.error && !o.stale).length };
}
