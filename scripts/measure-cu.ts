/**
 * Reads a lifecycle report and prints the compute units each step used, from the cluster's own transaction records.
 *   pnpm --filter @kekal/scripts measure-cu --cluster devnet --report lifecycle.json [--out cu.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "./lib/chain";
import { clusterConfig, parseArgs } from "./lib/config";
import { cuByStep } from "./lib/deploy";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.report) throw new Error("--report <lifecycle.json> is required");
  const c = clusterConfig(args.cluster);
  const conn = connect(c);
  const report = JSON.parse(readFileSync(args.report, "utf8")) as { paths: Record<string, { step: string; signature: string }[]> };
  const rows: { step: string; units: number | null }[] = [];
  for (const steps of Object.values(report.paths)) {
    for (const { step, signature } of steps) {
      const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      rows.push({ step, units: tx?.meta?.computeUnitsConsumed ?? null });
    }
  }
  const table = cuByStep(rows);
  const missing = rows.filter((r) => r.units === null).length;
  if (args.out) writeFileSync(args.out, `${JSON.stringify({ cluster: c.name, steps: table, missing }, null, 2)}\n`);
  for (const s of table) console.log(`${s.step.padEnd(22)} ${String(s.transactions).padStart(3)} tx  ${s.min}-${s.max} CU`);
  if (missing > 0) console.log(`${missing} transaction(s) not found`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
