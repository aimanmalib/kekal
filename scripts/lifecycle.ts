/**
 * Runs the five warranty paths (A to E) against a live cluster and checks each final state.
 *   pnpm lifecycle --cluster localnet [--out report.json]
 * Localnet: `bash scripts/localnet.sh` starts a validator with the built program and runs this.
 */
import { readOnlyProgram } from "@kekal/sdk";
import { PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";
import { connect } from "./lib/chain";
import { clusterConfig, explorerUrl, parseArgs } from "./lib/config";
import { pathA, pathB, pathC, pathD, pathE } from "./lib/paths";
import { ensureConfig, ensureMint, ensureShop, freshOwner, fundRoles, issue, loadRoles, type Env, type Log } from "./lib/setup";

interface Step {
  step: string;
  signature: string;
  explorer: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const c = clusterConfig(args.cluster);
  const conn = connect(c);
  const program = readOnlyProgram(conn, c.programId ? new PublicKey(c.programId) : undefined);
  const roles = loadRoles(c);
  const started = Date.now();
  const report: Record<string, Step[]> = { setup: [] };
  const logger =
    (path: string): Log =>
    (step, signature) => {
      (report[path] ??= []).push({ step, signature, explorer: explorerUrl(c, signature) });
      console.log(`${path.padEnd(5)} ${step.padEnd(20)} ${signature}`);
    };

  if (!(await conn.getAccountInfo(program.programId))?.executable) {
    throw new Error(`program ${program.programId.toBase58()} is not deployed on ${c.name}`);
  }
  await fundRoles({ c, conn, roles });
  const mint = await ensureMint(c, conn, roles.admin);
  const env: Env = { c, conn, program, roles, mint, mintAuthority: roles.admin };
  const setup = logger("setup");
  await ensureConfig(env, setup);
  await ensureShop(env, roles.seller, c.lifecycle.shopWindows, setup);
  const dying = await freshOwner(env);
  await ensureShop(env, dying, c.lifecycle.dyingShopWindows, setup);

  // Issue sequentially (warranty ids come from the shop counter), then run the paths in parallel.
  const L = c.lifecycle;
  const wA = await issue(env, roles.seller, L.termSecs, "A", logger("A"));
  const wB = await issue(env, roles.seller, L.termSecs, "B", logger("B"));
  const wD = await issue(env, roles.seller, L.shortTermSecs, "D", logger("D"));
  const wE = await issue(env, roles.seller, L.termSecs, "E", logger("E"));
  // The dying shop has a heartbeat window of seconds: heartbeat and issue go in one transaction (same clock).
  const wC = await issue(env, dying, L.termSecs, "C", logger("C"), { heartbeatFirst: true });

  await Promise.all([
    pathA(env, wA, logger("A")),
    pathB(env, wB, logger("B")),
    pathC(env, wC, logger("C")),
    pathD(env, wD, logger("D")),
    pathE(env, wE, logger("E")),
  ]);

  const summary = {
    cluster: c.name,
    programId: program.programId.toBase58(),
    mint: mint.toBase58(),
    seconds: Math.round((Date.now() - started) / 1000),
    paths: report,
  };
  if (args.out) writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`lifecycle ${c.name}: paths A-E passed in ${summary.seconds} s`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
