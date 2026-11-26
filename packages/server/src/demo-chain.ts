// On-chain steps behind /api/demo/* (PRD 4.6). Keys, connection and settings are passed in, so the localnet check
// script and the web routes run the same code.
import {
  ClaimStatus,
  WarrantyStatus,
  canonicalJson,
  claimPda,
  fetchClaim,
  fetchShop,
  fetchWarranty,
  hashJson,
  ix,
  sha256Bytes,
  shopPda,
  warrantyPda,
  type KekalProgram,
  type ShopWindows,
} from "@kekal/sdk";
import {
  ACCOUNT_SIZE,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, SystemProgram, type Connection, type PublicKey } from "@solana/web3.js";
import { sendSigned } from "./chain";
import { appConfig } from "./cluster";

export interface DemoShopSettings {
  reserve: string;
  termSecs: number;
  /** marginLamports: extra SOL for the throwaway owner on top of the rent it pays; 0, or at least the rent of an empty account. */
  dyingShop: { windows: ShopWindows; marginLamports: number };
  /** depositAmount: kUSD the shared shop's owner moves from its own account into the shop when the shop's free balance
   * cannot cover one more reserve (each paid card takes its reserve out for good). */
  sharedShop: { depositAmount: string };
}

export interface DemoChain {
  conn: Connection;
  program: KekalProgram;
  mint: PublicKey;
  decimals: number;
  /** Owner of the shared demo shop; also funds each dying shop. */
  seller: Keypair;
  arbiter: Keypair;
  /** Pays fees and payout rent for arbiter rulings. */
  feePayer: Keypair;
  settings: DemoShopSettings;
}

export type DemoErrorCode =
  | "demo_shop_missing"
  | "not_demo_shop"
  | "no_open_claim"
  | "claim_not_pending"
  | "claim_not_disputed"
  | "wrong_arbiter";

export class DemoError extends Error {
  constructor(readonly code: DemoErrorCode) {
    super(code);
  }
}

export interface Issued {
  shop: PublicKey;
  warranty: PublicKey;
  signatures: string[];
  /** Canonical terms text whose hash the warranty carries. */
  termsJson: string;
}

// Warranty ids come from the shop counter, so issues on one shop must not overlap within this process.
const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(job, job);
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/** Canonical terms text of a demo warranty; its SHA-256 is the on-chain terms_hash. */
export function demoTermsJson(d: Pick<DemoChain, "settings">, label: string): string {
  const terms: Record<string, unknown> = { ...appConfig.demoTerms };
  delete terms._doc;
  return canonicalJson({ ...terms, kind: label, reserve: d.settings.reserve, termSecs: d.settings.termSecs });
}

function demoParams(d: DemoChain, holder: PublicKey, label: string) {
  const termsJson = demoTermsJson(d, label);
  return {
    params: {
      holder,
      reserve: BigInt(d.settings.reserve),
      termSecs: d.settings.termSecs,
      termsHash: sha256Bytes(new TextEncoder().encode(termsJson)),
      productHash: hashJson({ demo: label, holder: holder.toBase58() }),
    },
    termsJson,
  };
}

/** kUSD to deposit into the shared shop before the next issue: 0 while its free balance covers one reserve, otherwise
 * depositAmount (or the shortfall, if larger). */
export function sharedShopTopUp(free: bigint, reserve: bigint, depositAmount: bigint): bigint {
  if (free >= reserve) return 0n;
  const shortfall = reserve - free;
  return depositAmount > shortfall ? depositAmount : shortfall;
}

/** Issues one warranty from the shared demo shop to `holder`. A heartbeat rides in the same transaction, and a deposit
 * from the owner's own account when the shop's free balance is short (sharedShopTopUp). */
export function issueToHolder(d: DemoChain, holder: PublicKey): Promise<Issued> {
  const owner = d.seller.publicKey;
  const shop = shopPda(d.program.programId, owner);
  return serial(shop.toBase58(), async () => {
    const state = await fetchShop(d.program, shop);
    if (!state) throw new DemoError("demo_shop_missing");
    const terms = demoParams(d, holder, "shared");
    const ixs = [await ix.heartbeat(d.program, { owner })];
    const topUp = sharedShopTopUp(state.freeBalance, BigInt(d.settings.reserve), BigInt(d.settings.sharedShop.depositAmount));
    if (topUp > 0n) {
      const ownerToken = getAssociatedTokenAddressSync(d.mint, owner);
      ixs.push(await ix.deposit(d.program, { owner, mint: d.mint, ownerToken, amount: topUp }));
    }
    ixs.push(await ix.issueWarranty(d.program, { owner, warrantyId: state.nextWarrantyId, params: terms.params }));
    const sig = await sendSigned(d.conn, d.seller, ixs);
    return { shop, warranty: warrantyPda(d.program.programId, shop, state.nextWarrantyId), signatures: [sig], termsJson: terms.termsJson };
  });
}

async function openClaim(d: DemoChain, warranty: PublicKey) {
  const w = await fetchWarranty(d.program, warranty);
  if (!w) throw new DemoError("no_open_claim");
  const key = claimPda(d.program.programId, warranty, w.openClaim);
  const claim = w.status === WarrantyStatus.Claimed ? await fetchClaim(d.program, key) : null;
  if (!claim) throw new DemoError("no_open_claim");
  return { w, key, claim };
}

/** The shared demo seller accepts or rejects the open claim of a demo warranty. */
export async function sellerRespond(d: DemoChain, warranty: PublicKey, accept: boolean): Promise<string> {
  const { w, key, claim } = await openClaim(d, warranty);
  if (!w.shop.equals(shopPda(d.program.programId, d.seller.publicKey))) throw new DemoError("not_demo_shop");
  if (claim.status !== ClaimStatus.Pending) throw new DemoError("claim_not_pending");
  const built = await ix.respondClaim(d.program, {
    owner: d.seller.publicKey,
    warranty,
    claim: key,
    accept,
    responseHash: hashJson({ demo: true, accept }),
  });
  return sendSigned(d.conn, d.seller, [built]);
}

/** The demo arbiter rules on an escalated claim. */
export async function arbiterResolve(d: DemoChain, warranty: PublicKey, buyerWins: boolean): Promise<string> {
  const { w, key, claim } = await openClaim(d, warranty);
  if (claim.status !== ClaimStatus.Disputed) throw new DemoError("claim_not_disputed");
  const shop = await fetchShop(d.program, w.shop);
  if (!shop?.arbiter.equals(d.arbiter.publicKey)) throw new DemoError("wrong_arbiter");
  const built = await ix.resolveDispute(d.program, {
    payer: d.feePayer.publicKey,
    shop: w.shop,
    mint: shop.mint,
    holder: w.holder,
    arbiter: d.arbiter.publicKey,
    buyerWins,
    warranty,
    claim: key,
  });
  return sendSigned(d.conn, d.feePayer, [built], [d.arbiter]);
}

// Rent depends only on the account size, so one RPC read per size per process.
const rents = new WeakMap<Connection, Map<number, Promise<number>>>();
function rentFor(conn: Connection, size: number): Promise<number> {
  let bySize = rents.get(conn);
  if (!bySize) rents.set(conn, (bySize = new Map()));
  let r = bySize.get(size);
  if (!r) {
    r = conn.getMinimumBalanceForRentExemption(size);
    r.catch(() => bySize.delete(size));
    bySize.set(size, r);
  }
  return r;
}

/**
 * SOL the throwaway owner of a dying shop needs: the rent of the three accounts it pays for (shop, vault, warranty)
 * plus the configured margin. Fees are paid by the shared seller, so the owner key ends at the margin (0 by default)
 * instead of keeping SOL nobody can spend.
 */
export async function dyingShopLamports(d: Pick<DemoChain, "conn" | "program" | "settings">): Promise<number> {
  const margin = d.settings.dyingShop.marginLamports;
  const accounts = d.program.account as unknown as Record<"shop" | "warranty", { size: number }>;
  const sizes = [accounts.shop.size, ACCOUNT_SIZE, accounts.warranty.size];
  const [empty, ...paid] = await Promise.all([rentFor(d.conn, 0), ...sizes.map((n) => rentFor(d.conn, n))]);
  // A system account may not be left holding less than the rent of an empty account, so a small margin would fail.
  if (margin !== 0 && margin < empty!) throw new Error(`dyingShop.marginLamports must be 0 or at least ${empty}`);
  return paid.reduce((a, b) => a + b, margin);
}

/**
 * Path C set-up: a shop with a fresh owner key, funded from the shared seller (SOL for rent, one reserve of kUSD),
 * issues one warranty to `holder`. The owner key is not returned or stored: nobody can heartbeat this shop again.
 * The owner's token account only carries the reserve into the vault, so it is closed in the same transaction and its
 * rent goes back to the shared seller.
 */
export async function dyingShop(d: DemoChain, holder: PublicKey): Promise<Issued> {
  const owner = Keypair.generate();
  const shop = shopPda(d.program.programId, owner.publicKey);
  const reserve = BigInt(d.settings.reserve);
  const create = await ix.createShop(d.program, {
    owner: owner.publicKey,
    mint: d.mint,
    windows: d.settings.dyingShop.windows,
    arbiter: d.arbiter.publicKey,
    profileHash: hashJson({ demo: "dying-shop", owner: owner.publicKey.toBase58() }),
  });
  const lamports = await dyingShopLamports(d);
  const fund = SystemProgram.transfer({ fromPubkey: d.seller.publicKey, toPubkey: owner.publicKey, lamports });
  const s1 = await sendSigned(d.conn, d.seller, [fund, create], [owner]);

  const from = getAssociatedTokenAddressSync(d.mint, d.seller.publicKey);
  const to = getAssociatedTokenAddressSync(d.mint, owner.publicKey);
  const terms = demoParams(d, holder, "dying");
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(d.seller.publicKey, to, owner.publicKey, d.mint),
    createTransferCheckedInstruction(from, d.mint, to, d.seller.publicKey, reserve, d.decimals),
    await ix.deposit(d.program, { owner: owner.publicKey, mint: d.mint, ownerToken: to, amount: reserve }),
    await ix.issueWarranty(d.program, { owner: owner.publicKey, warrantyId: 0n, params: terms.params }),
    createCloseAccountInstruction(to, d.seller.publicKey, owner.publicKey),
  ];
  const s2 = await sendSigned(d.conn, d.seller, ixs, [owner]);
  return { shop, warranty: warrantyPda(d.program.programId, shop, 0n), signatures: [s1, s2], termsJson: terms.termsJson };
}
