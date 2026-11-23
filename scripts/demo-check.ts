/**
 * Demo API chain steps + keeper, end to end on a local validator (no web server):
 *   LOCALNET_SCRIPT=demo-check.ts bash scripts/localnet.sh [--out report.json]
 * Seeds the demo, runs paths A and E through the seller/arbiter demo steps, leaves B (silent shop) and C (dying shop)
 * to one keeper pass, then checks a second pass has nothing left to do.
 */
import { runPass } from "@kekal/keeper/pass";
import { liveReader } from "@kekal/keeper/reader";
import { ClaimStatus, claimPda, fetchClaim, fetchShop, fetchWarranty, hashJson, ix, readOnlyProgram, scheduleShop, WarrantyStatus } from "@kekal/sdk";
import { arbiterResolve, DemoError, dyingShop, issueToHolder, sellerRespond, sendSigned, type DemoChain } from "@kekal/server";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { writeFileSync } from "node:fs";
import { connect, waitForChainTime } from "./lib/chain";
import { clusterConfig, explorerUrl, parseArgs } from "./lib/config";
import { seedDemo } from "./lib/seed";
import { ensureMint, fundRoles, loadRoles, type Env } from "./lib/setup";

const steps: { path: string; step: string; signature: string; explorer: string }[] = [];

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`demo-check: ${what}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const c = clusterConfig(args.cluster ?? "localnet");
  check(c.name === "localnet", "runs on localnet only (it airdrops and waits on short windows)");
  const conn = connect(c);
  const program = readOnlyProgram(conn, c.programId ? new PublicKey(c.programId) : undefined);
  const roles = loadRoles(c);
  const showcase = Keypair.generate();
  const record = (path: string) => (step: string, signature: string) => {
    steps.push({ path, step, signature, explorer: explorerUrl(c, signature) });
    console.log(`${path.padEnd(6)} ${step.padEnd(18)} ${signature}`);
  };
  await fundRoles({ c, conn, roles });
  const mint = await ensureMint(c, conn, roles.admin);
  const env: Env = { c, conn, program, roles, mint, mintAuthority: roles.admin };
  const seed = await seedDemo(env, roles.seller, showcase, record("seed"));
  check(seed.showcaseWarranties.length === c.demo.showcaseShop.warranties, "showcase cards issued");

  const chain: DemoChain = {
    conn,
    program,
    mint,
    decimals: c.tokenDecimals,
    seller: roles.seller,
    arbiter: roles.arbiter,
    feePayer: roles.feePayer,
    settings: c.demo,
  };
  const feePayer = roles.feePayer;
  const holderSend = (path: string, step: string, holder: Keypair) => async (built: Promise<import("@solana/web3.js").TransactionInstruction>) =>
    record(path)(step, await sendSigned(conn, feePayer, [await built], [holder]));
  const fileClaim = async (path: string, holder: Keypair, shop: PublicKey, warranty: PublicKey) => {
    const w = await fetchWarranty(program, warranty);
    await holderSend(path, "file_claim", holder)(
      ix.fileClaim(program, { payer: feePayer.publicKey, holder: holder.publicKey, shop, warranty, claimIndex: w!.claimCount, evidenceHash: hashJson({ demo: path }) }),
    );
    return claimPda(program.programId, warranty, w!.claimCount);
  };
  const paid = async (holder: Keypair) =>
    (await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, holder.publicKey, true)).catch(() => null))?.value.amount;

  // B and C first: their windows run while A and E go through the demo steps.
  const hB = Keypair.generate();
  const b = await issueToHolder(chain, hB.publicKey);
  record("B")("issue (demo)", b.signatures[0]!);
  const claimB = await fileClaim("B", hB, b.shop, b.warranty);
  const hC = Keypair.generate();
  const cIssued = await dyingShop(chain, hC.publicKey);
  cIssued.signatures.forEach((s, i) => record("C")(i === 0 ? "dying shop" : "fund + issue", s));

  // A: shop accepts (demo seller), holder confirms the repair.
  const hA = Keypair.generate();
  const a = await issueToHolder(chain, hA.publicKey);
  const claimA = await fileClaim("A", hA, a.shop, a.warranty);
  record("A")("seller accept", await sellerRespond(chain, a.warranty, true));
  await holderSend("A", "confirm_resolved", hA)(ix.confirmResolved(program, { holder: hA.publicKey, shop: a.shop, warranty: a.warranty, claim: claimA }));
  check((await fetchClaim(program, claimA))?.status === ClaimStatus.Resolved, "A: claim resolved");

  // E: shop rejects, holder escalates, demo arbiter rules for the buyer.
  const hE = Keypair.generate();
  const e = await issueToHolder(chain, hE.publicKey);
  const claimE = await fileClaim("E", hE, e.shop, e.warranty);
  record("E")("seller reject", await sellerRespond(chain, e.warranty, false));
  await holderSend("E", "escalate", hE)(ix.escalate(program, { holder: hE.publicKey, shop: e.shop, warranty: e.warranty, claim: claimE }));
  record("E")("arbiter rules", await arbiterResolve(chain, e.warranty, true));
  check((await paid(hE)) === c.demo.reserve, "E: holder paid by the arbiter ruling");
  const conflict = await sellerRespond(chain, e.warranty, true).catch((err: unknown) => err);
  check(conflict instanceof DemoError && conflict.code === "no_open_claim", "E: seller action on a settled warranty is refused");

  // Wait until B's response window and C's heartbeat have both run out, then one keeper pass.
  const [claim, shopB, dying] = await Promise.all([fetchClaim(program, claimB), fetchShop(program, b.shop), fetchShop(program, cIssued.shop)]);
  const due = Math.max(claim!.filedAt + shopB!.responseSecs + 1, scheduleShop(dying!)!.dueAt);
  await waitForChainTime(conn, due, c.lifecycle.timeoutSecs);
  const keeperDeps = {
    program,
    reader: liveReader(conn, program),
    send: (payer: Keypair, ixs: import("@solana/web3.js").TransactionInstruction[]) => sendSigned(conn, payer, ixs),
    feePayer,
    heartbeatOwners: [roles.seller],
    lastHeartbeat: new Map<string, number>(),
    heartbeatEverySecs: 30,
    maxActions: 40,
    log: (line: string) => console.log(`keeper ${line}`),
  };
  const first = await runPass(keeperDeps);
  for (const o of first.outcomes) if (o.signature) record("keeper")(o.step, o.signature);
  check(first.failed === 0, "keeper pass 1 without failures");
  const stepsDone = first.outcomes.map((o) => o.step);
  for (const s of ["heartbeat", "declareDormant", "claimOrphan", "settleUnanswered"]) check(stepsDone.includes(s), `keeper sent ${s}`);
  check(stepsDone.indexOf("declareDormant") < stepsDone.indexOf("claimOrphan"), "keeper declares dormant before paying orphans");
  check((await fetchWarranty(program, b.warranty))?.status === WarrantyStatus.PaidOut && (await paid(hB)) === c.demo.reserve, "B: holder paid");
  check((await fetchWarranty(program, cIssued.warranty))?.status === WarrantyStatus.PaidOut && (await paid(hC)) === c.demo.reserve, "C: holder paid");

  const second = await runPass(keeperDeps);
  check(second.outcomes.length === 0, `keeper pass 2 has nothing to do (sent ${second.outcomes.map((o) => o.step).join(", ")})`);

  if (args.out) writeFileSync(args.out, `${JSON.stringify({ cluster: c.name, programId: program.programId.toBase58(), steps }, null, 2)}\n`);
  console.log(`demo-check ${c.name}: A, B, C, E passed; keeper idempotent (${steps.length} transactions)`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
