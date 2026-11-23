import {
  configPda,
  fetchConfig,
  fetchShop,
  hashJson,
  ix,
  shopPda,
  ShopStatus,
  warrantyPda,
  type IssueParams,
  type KekalProgram,
  type ShopWindows,
} from "@kekal/sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  getMint,
  mintTo,
} from "@solana/spl-token";
import { Keypair, PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { airdrop, fundIx, roleKey, send } from "./chain";
import type { ClusterConfig } from "./config";

export interface Roles {
  admin: Keypair;
  seller: Keypair;
  arbiter: Keypair;
  assessor: Keypair;
  /** Pays fees for holder transactions, as the relayer does in the web app. */
  feePayer: Keypair;
}

export interface Env {
  c: ClusterConfig;
  conn: Connection;
  program: KekalProgram;
  roles: Roles;
  mint: PublicKey;
  mintAuthority: Keypair;
}

/** Records every transaction of a path for the report. */
export type Log = (step: string, sig: string) => void;

export function loadRoles(c: ClusterConfig): Roles {
  return {
    admin: roleKey(c, "deployer"),
    seller: roleKey(c, "demo-seller"),
    arbiter: roleKey(c, "arbiter"),
    assessor: roleKey(c, "assessor"),
    feePayer: roleKey(c, "relayer"),
  };
}

export async function fundRoles(env: Pick<Env, "c" | "conn" | "roles">): Promise<void> {
  const sol = env.c.lifecycle.airdropSol;
  if (sol <= 0) return;
  const { admin, seller, arbiter, feePayer } = env.roles;
  await Promise.all([admin, seller, arbiter, feePayer].map((k) => airdrop(env.conn, k.publicKey, sol)));
}

/** Uses the configured kUSD mint, else creates one (localnet; devnet uses the `kusd-mint` key as its address). */
export async function ensureMint(c: ClusterConfig, conn: Connection, authority: Keypair): Promise<PublicKey> {
  if (c.mints.kusd) return new PublicKey(c.mints.kusd);
  const mintKey = c.keysDir ? roleKey(c, "kusd-mint") : Keypair.generate();
  const existing = await getMint(conn, mintKey.publicKey).catch(() => null);
  if (existing) return mintKey.publicKey;
  return createMint(conn, authority, authority.publicKey, null, c.tokenDecimals, mintKey);
}

/** Creates `Config` when missing; otherwise checks the mint is allowed. */
export async function ensureConfig(env: Env, log: Log): Promise<void> {
  const { program, roles, c, mint } = env;
  const existing = await fetchConfig(program);
  if (existing) {
    if (!existing.allowedMints.some((m) => m.equals(mint))) {
      throw new Error(`mint ${mint.toBase58()} is not allowed by Config ${configPda(program.programId).toBase58()}`);
    }
    return;
  }
  const allowed = [mint, ...(c.mints.usdc ? [new PublicKey(c.mints.usdc)] : [])];
  const params = {
    defaultArbiter: roles.arbiter.publicKey,
    assessor: roles.assessor.publicKey,
    limits: c.limits,
    allowedMints: allowed,
    paused: false,
  };
  log("init_config", await send(env.conn, roles.admin, [await ix.initConfig(program, { admin: roles.admin.publicKey, params })]));
}

export async function mintTokens(env: Env, owner: PublicKey, amount: bigint): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(env.mint, owner);
  await send(env.conn, env.roles.admin, [
    createAssociatedTokenAccountIdempotentInstruction(env.roles.admin.publicKey, ata, owner, env.mint),
  ]);
  await mintTo(env.conn, env.roles.admin, env.mint, ata, env.mintAuthority, amount);
  return ata;
}

export interface ShopOptions {
  /** Free balance to top up to; defaults to the lifecycle deposit. */
  depositAmount?: string;
  profileName?: string;
}

/**
 * Creates the shop (if missing) for `owner` and tops its free balance up to the deposit amount. An existing active
 * shop gets a heartbeat first, so a short heartbeat window (the shared demo shop) cannot lapse during set-up.
 */
export async function ensureShop(env: Env, owner: Keypair, windows: ShopWindows, log: Log, opts: ShopOptions = {}): Promise<PublicKey> {
  const { program, conn } = env;
  const shop = shopPda(program.programId, owner.publicKey);
  const existing = await fetchShop(program, shop);
  if (!existing) {
    const createIx = await ix.createShop(program, {
      owner: owner.publicKey,
      mint: env.mint,
      windows,
      arbiter: env.roles.arbiter.publicKey,
      profileHash: hashJson({ name: opts.profileName ?? "Lifecycle test shop", owner: owner.publicKey.toBase58() }),
    });
    log("create_shop", await send(conn, owner, [createIx]));
  } else if (existing.status === ShopStatus.Active) {
    log("heartbeat", await send(conn, owner, [await ix.heartbeat(program, { owner: owner.publicKey })]));
  } else {
    throw new Error(`shop ${shop.toBase58()} is dormant; a dormant shop never reopens, configure a new owner key`);
  }
  const state = await fetchShop(program, shop);
  const target = BigInt(opts.depositAmount ?? env.c.lifecycle.depositAmount);
  if (state && state.freeBalance < target) {
    const amount = target - state.freeBalance;
    const ownerToken = await mintTokens(env, owner.publicKey, amount);
    const dep = await ix.deposit(program, { owner: owner.publicKey, mint: env.mint, ownerToken, amount });
    log("deposit", await send(conn, owner, [dep]));
  }
  return shop;
}

/** A throwaway shop owner funded from the admin key (dying-shop path C). */
export async function freshOwner(env: Env): Promise<Keypair> {
  const owner = Keypair.generate();
  await send(env.conn, env.roles.admin, [fundIx(env.roles.admin.publicKey, owner.publicKey, env.c.lifecycle.dyingShopSol)]);
  return owner;
}

export interface Issued {
  shop: PublicKey;
  warranty: PublicKey;
  holder: Keypair;
  owner: Keypair;
}

/**
 * Instructions that issue one warranty. `heartbeatFirst` puts a heartbeat in the same transaction, so a shop with a very
 * short heartbeat window (the dying shop of path C) cannot lapse between its last heartbeat and the issue on a slow host.
 */
export async function issueInstructions(
  program: KekalProgram,
  owner: PublicKey,
  warrantyId: bigint,
  params: IssueParams,
  heartbeatFirst: boolean,
): Promise<TransactionInstruction[]> {
  const built = await ix.issueWarranty(program, { owner, warrantyId, params });
  return heartbeatFirst ? [await ix.heartbeat(program, { owner }), built] : [built];
}

/** Issues one warranty to a fresh bearer key. Calls on the same shop must not run concurrently. */
export async function issue(
  env: Env,
  owner: Keypair,
  termSecs: number,
  label: string,
  log: Log,
  opts: { heartbeatFirst?: boolean } = {},
): Promise<Issued> {
  const { program } = env;
  const shop = shopPda(program.programId, owner.publicKey);
  const state = await fetchShop(program, shop);
  if (!state) throw new Error("shop missing");
  const holder = Keypair.generate();
  const params = {
    holder: holder.publicKey,
    reserve: BigInt(env.c.lifecycle.reserve),
    termSecs,
    termsHash: hashJson({ path: label, termSecs }),
    productHash: hashJson({ path: label, serial: holder.publicKey.toBase58() }),
  };
  const ixs = await issueInstructions(program, owner.publicKey, state.nextWarrantyId, params, opts.heartbeatFirst ?? false);
  log("issue_warranty", await send(env.conn, owner, ixs));
  return { shop, warranty: warrantyPda(program.programId, shop, state.nextWarrantyId), holder, owner };
}
