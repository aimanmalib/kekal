/**
 * Creates the kUSD mint (if missing) and the program `Config`, then checks the deployer key is `Config.admin`.
 *   pnpm --filter @kekal/scripts init-config --cluster devnet [--out init.json]
 * `scripts/deploy-program.sh` runs this right after `solana program deploy`, in the same run, because `init_config`
 * accepts its first caller. Exits 1 when `Config` belongs to another key or a configured mint is not allowed.
 */
import { configPda, fetchConfig, readOnlyProgram } from "@kekal/sdk";
import { getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";
import { connect } from "./lib/chain";
import { clusterConfig, explorerUrl, parseArgs } from "./lib/config";
import { configProblems } from "./lib/deploy";
import { ensureConfig, ensureMint, loadRoles, type Env } from "./lib/setup";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const c = clusterConfig(args.cluster);
  const conn = connect(c);
  const program = readOnlyProgram(conn, c.programId ? new PublicKey(c.programId) : undefined);
  if (!(await conn.getAccountInfo(program.programId))?.executable) {
    throw new Error(`program ${program.programId.toBase58()} is not deployed on ${c.name}`);
  }
  const roles = loadRoles(c);
  const mint = await ensureMint(c, conn, roles.admin);
  const usdc = c.mints.usdc ? new PublicKey(c.mints.usdc) : null;
  for (const m of [mint, ...(usdc ? [usdc] : [])]) {
    const info = await getMint(conn, m);
    if (info.decimals !== c.tokenDecimals) throw new Error(`mint ${m.toBase58()} has ${info.decimals} decimals, config says ${c.tokenDecimals}`);
  }
  const env: Env = { c, conn, program, roles, mint, mintAuthority: roles.admin };
  const steps: { step: string; signature: string; explorer: string }[] = [];
  await ensureConfig(env, (step, signature) => steps.push({ step, signature, explorer: explorerUrl(c, signature) }));

  const problems = configProblems(await fetchConfig(program), roles.admin.publicKey, [mint, ...(usdc ? [usdc] : [])]);
  const summary = {
    cluster: c.name,
    programId: program.programId.toBase58(),
    config: configPda(program.programId).toBase58(),
    admin: roles.admin.publicKey.toBase58(),
    mints: { kusd: mint.toBase58(), usdc: usdc?.toBase58() ?? null },
    steps,
    problems,
  };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (problems.length > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
