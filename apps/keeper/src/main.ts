/**
 * Keeper process (PRD 4.4): `pnpm --filter @kekal/keeper start [--once]`.
 * Env: KEKAL_CLUSTER, RPC_URLS, KEKAL_PROGRAM_ID, KEKAL_KEYS_DIR, KEKAL_SQLITE_PATH, KEKAL_MIGRATIONS_DIR (see config/app.json).
 */
import { readOnlyProgram } from "@kekal/sdk";
import { appConfig, failoverConnection, findUp, loadKeypair, openSqlite, runtimeCluster, sendSigned, type DataStore } from "@kekal/server";
import { PublicKey, type Keypair } from "@solana/web3.js";
import { isAbsolute, join } from "node:path";
import { runPass } from "./pass";
import { liveReader } from "./reader";

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

function openStore(env: NodeJS.ProcessEnv): DataStore {
  const data = appConfig.web.data;
  const migrations = env.KEKAL_MIGRATIONS_DIR ?? findUp(data.migrationsDir, process.cwd());
  if (!migrations) throw new Error(`migrations folder ${data.migrationsDir} not found; set KEKAL_MIGRATIONS_DIR`);
  const raw = env.KEKAL_SQLITE_PATH ?? data.sqlitePath;
  return openSqlite(isAbsolute(raw) || raw === ":memory:" ? raw : join(process.cwd(), raw), migrations);
}

function optionalKey(keysDir: string | null, role: string): Keypair | null {
  try {
    return loadKeypair(keysDir, role);
  } catch (e) {
    log(`heartbeat role ${role} skipped: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  const once = process.argv.includes("--once");
  const k = appConfig.keeper;
  const cluster = runtimeCluster();
  const conn = failoverConnection({ urls: cluster.rpcUrls, timeoutMs: appConfig.web.rpc.timeoutMs, retryStatuses: appConfig.web.rpc.retryStatuses });
  const program = readOnlyProgram(conn, new PublicKey(cluster.programId));
  const feePayer = loadKeypair(cluster.keysDir, k.feePayerRole);
  const heartbeatOwners = k.heartbeatRoles.map((r) => optionalKey(cluster.keysDir, r)).filter((x): x is Keypair => x !== null);
  const store = openStore(process.env);
  const lastHeartbeat = new Map<string, number>();
  log(`keeper on ${cluster.name}, program ${cluster.programId}, every ${k.intervalSecs} s`);

  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  const stop = () => {
    stopping = true;
    if (timer) clearTimeout(timer);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  const pass = async (): Promise<boolean> => {
    try {
      const r = await runPass({
        program,
        reader: liveReader(conn, program),
        send: (payer, ixs) => sendSigned(conn, payer, ixs),
        feePayer,
        heartbeatOwners,
        lastHeartbeat,
        heartbeatEverySecs: k.heartbeatEverySecs,
        maxActions: k.maxActionsPerPass,
        log,
      });
      store.setConfig(k.lastRunKey, String(Math.floor(Date.now() / 1000)), Math.floor(Date.now() / 1000));
      if (r.outcomes.length > 0 || r.failed > 0) log(`pass at ${r.clock}: ${r.outcomes.length} sent, ${r.failed} failed`);
      return r.failed === 0;
    } catch (e) {
      log(`pass failed: ${(e as Error).message}`);
      return false;
    }
  };

  if (once) {
    const ok = await pass();
    store.close();
    process.exit(ok ? 0 : 1);
  }
  const loop = async () => {
    if (stopping) return;
    await pass();
    if (!stopping) timer = setTimeout(() => void loop(), k.intervalSecs * 1000);
    else store.close();
  };
  await loop();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
