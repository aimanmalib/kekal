/**
 * Recreates the demo state in one command (risk R4: a reset devnet or a fresh deploy):
 *   pnpm --filter @kekal/scripts seed-demo --cluster devnet [--out seed.json]
 * Config (if missing), the kUSD mint, the shared demo shop (deposit + the seller float that funds dying shops),
 * the showcase shop and its cards. Safe to run again: it only tops up.
 */
import { readOnlyProgram } from "@kekal/sdk";
import { PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";
import { connect } from "./lib/chain";
import { clusterConfig, explorerUrl, parseArgs } from "./lib/config";
import { ensureRoleKey, seedDemo } from "./lib/seed";
import { ensureMint, fundRoles, loadRoles, type Env, type Log } from "./lib/setup";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const c = clusterConfig(args.cluster);
  const conn = connect(c);
  const program = readOnlyProgram(conn, c.programId ? new PublicKey(c.programId) : undefined);
  if (!(await conn.getAccountInfo(program.programId))?.executable) {
    throw new Error(`program ${program.programId.toBase58()} is not deployed on ${c.name}`);
  }
  const roles = { ...loadRoles(c), seller: ensureRoleKey(c, c.demo.sharedShop.role) };
  const showcase = ensureRoleKey(c, c.demo.showcaseShop.role);
  await fundRoles({ c, conn, roles });
  const mint = await ensureMint(c, conn, roles.admin);
  const env: Env = { c, conn, program, roles, mint, mintAuthority: roles.admin };
  const steps: { step: string; signature: string; explorer: string }[] = [];
  const log: Log = (step, signature) => {
    steps.push({ step, signature, explorer: explorerUrl(c, signature) });
    console.log(`${step.padEnd(16)} ${signature}`);
  };
  const r = await seedDemo(env, roles.seller, showcase, log);
  const summary = {
    cluster: c.name,
    programId: program.programId.toBase58(),
    mint: mint.toBase58(),
    sharedShop: r.sharedShop.toBase58(),
    showcaseShop: r.showcaseShop.toBase58(),
    showcaseWarranties: r.showcaseWarranties.map((w) => w.toBase58()),
    steps,
  };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`seed-demo ${c.name}: shared shop ${summary.sharedShop}, showcase ${summary.showcaseShop} (${r.showcaseWarranties.length} cards)`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
