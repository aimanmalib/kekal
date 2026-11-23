// On-chain steps behind /api/demo/* (PRD 4.6). Keys, connection and settings are passed in, so the localnet check
// script and the web routes run the same code.
import {
  ClaimStatus,
  WarrantyStatus,
  claimPda,
  fetchClaim,
  fetchShop,
  fetchWarranty,
  hashJson,
  ix,
  shopPda,
  warrantyPda,
  type KekalProgram,
  type ShopWindows,
} from "@kekal/sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, type Connection, type PublicKey } from "@solana/web3.js";
import { sendSigned } from "./chain";

export interface DemoShopSettings {
  reserve: string;
  termSecs: number;
  dyingShop: { windows: ShopWindows; sol: number };
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

function demoParams(d: DemoChain, holder: PublicKey, label: string) {
  return {
    holder,
    reserve: BigInt(d.settings.reserve),
    termSecs: d.settings.termSecs,
    termsHash: hashJson({ demo: label, reserve: d.settings.reserve, termSecs: d.settings.termSecs }),
    productHash: hashJson({ demo: label, holder: holder.toBase58() }),
  };
}

/** Issues one warranty from the shared demo shop to `holder`. A heartbeat rides in the same transaction. */
export function issueToHolder(d: DemoChain, holder: PublicKey): Promise<Issued> {
  const owner = d.seller.publicKey;
  const shop = shopPda(d.program.programId, owner);
  return serial(shop.toBase58(), async () => {
    const state = await fetchShop(d.program, shop);
    if (!state) throw new DemoError("demo_shop_missing");
    const issue = await ix.issueWarranty(d.program, {
      owner,
      warrantyId: state.nextWarrantyId,
      params: demoParams(d, holder, "shared"),
    });
    const sig = await sendSigned(d.conn, d.seller, [await ix.heartbeat(d.program, { owner }), issue]);
    return { shop, warranty: warrantyPda(d.program.programId, shop, state.nextWarrantyId), signatures: [sig] };
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

/**
 * Path C set-up: a shop with a fresh owner key, funded from the shared seller (SOL for rent, one reserve of kUSD),
 * issues one warranty to `holder`. The owner key is not returned or stored: nobody can heartbeat this shop again.
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
  const lamports = Math.round(d.settings.dyingShop.sol * LAMPORTS_PER_SOL);
  const fund = SystemProgram.transfer({ fromPubkey: d.seller.publicKey, toPubkey: owner.publicKey, lamports });
  const s1 = await sendSigned(d.conn, d.seller, [fund, create], [owner]);

  const from = getAssociatedTokenAddressSync(d.mint, d.seller.publicKey);
  const to = getAssociatedTokenAddressSync(d.mint, owner.publicKey);
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(d.seller.publicKey, to, owner.publicKey, d.mint),
    createTransferCheckedInstruction(from, d.mint, to, d.seller.publicKey, reserve, d.decimals),
    await ix.deposit(d.program, { owner: owner.publicKey, mint: d.mint, ownerToken: to, amount: reserve }),
    await ix.issueWarranty(d.program, { owner: owner.publicKey, warrantyId: 0n, params: demoParams(d, holder, "dying") }),
  ];
  const s2 = await sendSigned(d.conn, d.seller, ixs, [owner]);
  return { shop, warranty: warrantyPda(d.program.programId, shop, 0n), signatures: [s1, s2] };
}
