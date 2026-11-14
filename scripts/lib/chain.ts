import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expandHome, type ClusterConfig } from "./config";

export const COMMITMENT = "confirmed" as const;

export function connect(c: ClusterConfig): Connection {
  return new Connection(c.rpcUrls[0]!, COMMITMENT);
}

/** Loads `<keysDir>/<name>.json`; with no keys dir (localnet) a fresh key is generated. */
export function roleKey(c: ClusterConfig, name: string): Keypair {
  if (!c.keysDir) return Keypair.generate();
  const file = join(expandHome(c.keysDir), `${name}.json`);
  if (!existsSync(file)) throw new Error(`missing key file for role "${name}" in the keys directory`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[]));
}

export async function send(
  conn: Connection,
  feePayer: Keypair,
  ixs: TransactionInstruction[],
  signers: Keypair[] = [],
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = feePayer.publicKey;
  const unique = [feePayer, ...signers.filter((s) => !s.publicKey.equals(feePayer.publicKey))];
  return sendAndConfirmTransaction(conn, tx, unique, { commitment: COMMITMENT });
}

/** Cluster clock (`Clock` sysvar `unix_timestamp`), the same value the program reads. */
export async function chainTime(conn: Connection): Promise<number> {
  const info = await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, COMMITMENT);
  if (!info) throw new Error("clock sysvar unavailable");
  return Number(info.data.readBigInt64LE(32));
}

/** Polls the cluster clock until it reaches `t` (unix seconds). */
export async function waitForChainTime(conn: Connection, t: number, timeoutSecs: number): Promise<void> {
  const deadline = Date.now() + timeoutSecs * 1000;
  for (;;) {
    if ((await chainTime(conn)) >= t) return;
    if (Date.now() > deadline) throw new Error(`cluster clock did not reach ${t} within ${timeoutSecs} s`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function airdrop(conn: Connection, to: PublicKey, sol: number): Promise<void> {
  const sig = await conn.requestAirdrop(to, Math.round(sol * LAMPORTS_PER_SOL));
  const bh = await conn.getLatestBlockhash(COMMITMENT);
  await conn.confirmTransaction({ signature: sig, ...bh }, COMMITMENT);
}

export function fundIx(from: PublicKey, to: PublicKey, sol: number): TransactionInstruction {
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) });
}
