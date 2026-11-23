/**
 * Sample warranties on an already running local validator, for checking the web pages in a browser:
 *   pnpm --filter @kekal/scripts exec tsx page-fixtures.ts --cluster localnet --dir <empty folder>
 * Seeds the demo shops, issues warranties from the shared demo shop to fresh card keys and writes:
 *   <dir>/keys/{relayer,demo-seller,arbiter}.json  throwaway localnet keys (KEKAL_KEYS_DIR for the web app)
 *   <dir>/keys/test-wallet[-N].json                 browser test wallets for /kedai (--wallets n, default 1): SOL + kUSD
 *   <dir>/kekal.db                                  terms text of each warranty (KEKAL_SQLITE_PATH)
 *   <dir>/fixtures.json                             mint, wallet addresses, warranty addresses and card links (#k=<seed>)
 * Card seeds are localnet throwaways; never point this at devnet.
 */
import { base58, readOnlyProgram } from "@kekal/sdk";
import { issueToHolder, openSqlite, type DemoChain } from "@kekal/server";
import { Keypair, PublicKey } from "@solana/web3.js";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect } from "./lib/chain";
import { clusterConfig, parseArgs } from "./lib/config";
import { seedDemo } from "./lib/seed";
import { airdrop } from "./lib/chain";
import { ensureMint, fundRoles, loadRoles, mintTokens, type Env } from "./lib/setup";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const c = clusterConfig(args.cluster ?? "localnet");
  if (c.name !== "localnet") throw new Error("page-fixtures: localnet only (it airdrops and writes keys to disk)");
  if (!args.dir) throw new Error("page-fixtures: --dir <folder> is required");
  const dir = resolve(args.dir);
  const count = Number(args.count ?? "2");
  const conn = connect(c);
  const program = readOnlyProgram(conn, c.programId ? new PublicKey(c.programId) : undefined);
  const roles = loadRoles(c);
  await fundRoles({ c, conn, roles });
  const mint = await ensureMint(c, conn, roles.admin);
  const env: Env = { c, conn, program, roles, mint, mintAuthority: roles.admin };
  await seedDemo(env, roles.seller, Keypair.generate(), () => undefined);

  const walletCount = Number(args.wallets ?? "1");
  const wallets: Keypair[] = [];
  for (let i = 0; i < walletCount; i++) {
    const wallet = Keypair.generate();
    await airdrop(conn, wallet.publicKey, c.lifecycle.airdropSol);
    await mintTokens(env, wallet.publicKey, BigInt(c.lifecycle.mintAmount));
    wallets.push(wallet);
  }

  mkdirSync(join(dir, "keys"), { recursive: true });
  const keyFiles: [string, Keypair][] = [["relayer", roles.feePayer], ["demo-seller", roles.seller], ["arbiter", roles.arbiter]];
  wallets.forEach((w, i) => keyFiles.push([i === 0 ? "test-wallet" : `test-wallet-${i}`, w]));
  for (const [name, kp] of keyFiles) {
    const file = join(dir, "keys", `${name}.json`);
    writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
    chmodSync(file, 0o600);
  }
  const chain: DemoChain = {
    conn, program, mint, decimals: c.tokenDecimals, seller: roles.seller, arbiter: roles.arbiter, feePayer: roles.feePayer, settings: c.demo,
  };
  const store = openSqlite(join(dir, "kekal.db"), resolve(import.meta.dirname, "../supabase/migrations"));
  const cards: { warranty: string; fragment: string }[] = [];
  for (let i = 0; i < count; i++) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const issued = await issueToHolder(chain, Keypair.fromSeed(seed).publicKey);
    store.putWarrantyTerms(issued.warranty.toBase58(), issued.termsJson, Math.floor(Date.now() / 1000));
    cards.push({ warranty: issued.warranty.toBase58(), fragment: `#k=${base58.encode(seed)}` });
  }
  store.close();
  writeFileSync(join(dir, "fixtures.json"), JSON.stringify({ mint: mint.toBase58(), programId: program.programId.toBase58(), wallet: wallets[0]?.publicKey.toBase58() ?? null, wallets: wallets.map((w) => w.publicKey.toBase58()), cards }, null, 2));
  console.log(`page-fixtures: ${cards.length} warranties, mint ${mint.toBase58()}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
