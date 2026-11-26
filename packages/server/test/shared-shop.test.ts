// Path B must keep working after many runs: every paid card takes its reserve out of the shared demo shop for good, so
// when the shop's free balance cannot cover one more reserve the owner tops it up from its own account in the same
// transaction as the issue.
import { describe, expect, it } from "vitest";
import { readOnlyProgram } from "@kekal/sdk";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { issueToHolder, sharedShopTopUp, type DemoChain } from "../src";

const RESERVE = 25_000_000n;
const DEPOSIT = 200_000_000n;

// Just enough of a BN for the account decoder (u64 fields become bigint).
const bn = (v: bigint | number) => ({ toArray: () => [], isNeg: () => false, toString: () => String(v), toNumber: () => Number(v) });

function setup(freeBalance: bigint) {
  const sent: Transaction[] = [];
  const conn = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    sendRawTransaction: async (raw: Buffer) => (sent.push(Transaction.from(raw)), `sig${sent.length}`),
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    getBlockHeight: async () => 1,
  } as unknown as Connection;
  const program = readOnlyProgram(new Connection("http://127.0.0.1:1"));
  const shop = { freeBalance: bn(freeBalance), lockedBalance: bn(0), nextWarrantyId: bn(7), status: 0 };
  (program.account as unknown as Record<string, unknown>).shop = { fetchNullable: async () => shop };
  const d: DemoChain = {
    conn,
    program,
    mint: Keypair.generate().publicKey,
    decimals: 6,
    seller: Keypair.generate(),
    arbiter: Keypair.generate(),
    feePayer: Keypair.generate(),
    settings: {
      reserve: String(RESERVE),
      termSecs: 31536000,
      dyingShop: { windows: { responseSecs: 60, repairSecs: 60, disputeSecs: 60, heartbeatSecs: 60, graceSecs: 0 }, marginLamports: 0 },
      sharedShop: { depositAmount: String(DEPOSIT) },
    },
  };
  return { d, sent };
}

/** Anchor names of the Kekal instructions in a transaction. */
function kekalNames(d: DemoChain, tx: Transaction): string[] {
  const idl = d.program.idl.instructions;
  return tx.instructions
    .filter((i) => i.programId.equals(d.program.programId))
    .map((i) => idl.find((x) => Buffer.from(x.discriminator).equals(i.data.subarray(0, 8)))?.name ?? "?");
}

describe("shared demo shop top-up", () => {
  it("deposits nothing while the free balance covers one reserve", () => {
    expect(sharedShopTopUp(RESERVE, RESERVE, DEPOSIT)).toBe(0n);
  });

  it("deposits depositAmount, or the shortfall when that is larger", () => {
    expect(sharedShopTopUp(RESERVE - 1n, RESERVE, DEPOSIT)).toBe(DEPOSIT);
    expect(sharedShopTopUp(0n, 300_000_000n, DEPOSIT)).toBe(300_000_000n);
  });

  it("issues without a deposit when the shop can cover the reserve", async () => {
    const { d, sent } = setup(RESERVE);
    await issueToHolder(d, Keypair.generate().publicKey);
    expect(sent).toHaveLength(1);
    expect(kekalNames(d, sent[0]!)).toEqual(["heartbeat", "issueWarranty"]);
  });

  it("tops up from the owner's own token account before issuing when the shop is short", async () => {
    const { d, sent } = setup(RESERVE - 1n);
    await issueToHolder(d, Keypair.generate().publicKey);
    expect(sent).toHaveLength(1);
    expect(kekalNames(d, sent[0]!)).toEqual(["heartbeat", "deposit", "issueWarranty"]);
    const deposit = sent[0]!.instructions.find((i) => kekalNames(d, new Transaction().add(i))[0] === "deposit")!;
    const ownerToken = getAssociatedTokenAddressSync(d.mint, d.seller.publicKey);
    expect(deposit.keys.some((k) => k.pubkey.equals(ownerToken))).toBe(true);
    expect(deposit.keys.some((k) => k.pubkey.equals(TOKEN_PROGRAM_ID))).toBe(true);
  });
});
