// Demo state (PRD 4.6, risk R4): Config, mint, the shared demo shop with its float, the showcase shop and its cards.
// Every step checks what exists first, so running it again only tops up.
import { fetchShop, hashJson, shopPda, warrantyPda, type KekalProgram } from "@kekal/sdk";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fundIx, roleKey, send } from "./chain";
import { expandHome, type ClusterConfig } from "./config";
import { ensureConfig, ensureShop, issueInstructions, mintTokens, type Env, type Log } from "./setup";

/** Loads a role key; on a cluster with a keys folder, creates the file (mode 0600) when it does not exist yet. */
export function ensureRoleKey(c: ClusterConfig, name: string): Keypair {
  if (c.keysDir) {
    const dir = expandHome(c.keysDir);
    const file = join(dir, `${name}.json`);
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(file, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600, flag: "wx" });
    }
  }
  return roleKey(c, name);
}

export interface SeedResult {
  sharedShop: PublicKey;
  showcaseShop: PublicKey;
  showcaseWarranties: PublicKey[];
}

async function tokenBalance(env: Env, owner: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(env.mint, owner);
  const acc = await getAccount(env.conn, ata).catch(() => null);
  return acc?.amount ?? 0n;
}

/** Issues showcase cards until the showcase shop has `count` (ids 0..count-1). */
async function ensureShowcaseCards(env: Env, program: KekalProgram, owner: Keypair, count: number, log: Log): Promise<PublicKey[]> {
  const shop = shopPda(program.programId, owner.publicKey);
  const out: PublicKey[] = [];
  for (;;) {
    const state = await fetchShop(program, shop);
    if (!state || state.nextWarrantyId >= BigInt(count)) break;
    const id = state.nextWarrantyId;
    const holder = Keypair.generate().publicKey; // nobody holds these cards: they only show a realistic shop
    const params = {
      holder,
      reserve: BigInt(env.c.demo.reserve),
      termSecs: env.c.demo.termSecs,
      termsHash: hashJson({ showcase: Number(id), termSecs: env.c.demo.termSecs }),
      productHash: hashJson({ showcase: Number(id), holder: holder.toBase58() }),
    };
    log("issue_warranty", await send(env.conn, owner, await issueInstructions(program, owner.publicKey, id, params, false)));
  }
  const final = await fetchShop(program, shop);
  for (let i = 0n; i < (final?.nextWarrantyId ?? 0n) && i < BigInt(count); i++) out.push(warrantyPda(program.programId, shop, i));
  return out;
}

export async function seedDemo(env: Env, shared: Keypair, showcase: Keypair, log: Log): Promise<SeedResult> {
  const d = env.c.demo;
  await ensureConfig(env, log);
  const sharedShop = await ensureShop(env, shared, d.sharedShop.windows, log, {
    depositAmount: d.sharedShop.depositAmount,
    profileName: "Kekal demo shop",
  });
  const float = BigInt(d.sharedShop.sellerFloat);
  const have = await tokenBalance(env, shared.publicKey);
  if (have < float) {
    await mintTokens(env, shared.publicKey, float - have);
  }
  const want = Math.round(d.showcaseShop.sol * LAMPORTS_PER_SOL);
  const lamports = await env.conn.getBalance(showcase.publicKey);
  if (lamports < want) {
    log("fund_showcase", await send(env.conn, env.roles.admin, [fundIx(env.roles.admin.publicKey, showcase.publicKey, (want - lamports) / LAMPORTS_PER_SOL)]));
  }
  const showcaseShop = await ensureShop(env, showcase, d.showcaseShop.windows, log, {
    depositAmount: d.showcaseShop.depositAmount,
    profileName: "Kekal showcase shop",
  });
  const showcaseWarranties = await ensureShowcaseCards(env, env.program, showcase, d.showcaseShop.warranties, log);
  return { sharedShop, showcaseShop, showcaseWarranties };
}
