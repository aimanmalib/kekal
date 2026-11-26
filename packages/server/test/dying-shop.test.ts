// Path C must not strand SOL in the throwaway owner key: it is funded with the rent it pays and nothing more, and the
// token account the seller opened for it is closed back to the seller in the same transaction.
import { describe, expect, it } from "vitest";
import { readOnlyProgram } from "@kekal/sdk";
import { ACCOUNT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, SystemInstruction, SystemProgram, Transaction } from "@solana/web3.js";
import { dyingShop, dyingShopLamports, type DemoChain } from "../src";

// Rent formula of the current Solana runtime; the fake RPC answers with it.
const rent = (size: number) => (128 + size) * 6960;

function fakeConn() {
  const sent: Transaction[] = [];
  const rentReads: number[] = [];
  const conn = {
    getMinimumBalanceForRentExemption: async (size: number) => (rentReads.push(size), rent(size)),
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    sendRawTransaction: async (raw: Buffer) => (sent.push(Transaction.from(raw)), `sig${sent.length}`),
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    getBlockHeight: async () => 1,
  } as unknown as Connection;
  return { conn, sent, rentReads };
}

function chain(conn: Connection, marginLamports = 0): DemoChain {
  const program = readOnlyProgram(new Connection("http://127.0.0.1:1"));
  return {
    conn,
    program,
    mint: Keypair.generate().publicKey,
    decimals: 6,
    seller: Keypair.generate(),
    arbiter: Keypair.generate(),
    feePayer: Keypair.generate(),
    settings: {
      reserve: "25000000",
      termSecs: 31536000,
      dyingShop: {
        windows: { responseSecs: 60, repairSecs: 60, disputeSecs: 60, heartbeatSecs: 60, graceSecs: 0 },
        marginLamports,
      },
    },
  };
}

describe("dyingShop funding", () => {
  it("funds the owner with the rent of shop, vault and warranty only", async () => {
    const { conn, sent } = fakeConn();
    const d = chain(conn);
    await dyingShop(d, Keypair.generate().publicKey);
    const fund = sent[0]!.instructions.find((i) => i.programId.equals(SystemProgram.programId))!;
    const { lamports, fromPubkey } = SystemInstruction.decodeTransfer(fund);
    expect(fromPubkey.equals(d.seller.publicKey)).toBe(true);
    // Shop and warranty sizes (8-byte discriminator + INIT_SPACE) from the IDL; vault is an SPL token account.
    expect(Number(lamports)).toBe(rent(300) + rent(ACCOUNT_SIZE) + rent(182));
  });

  it("closes the owner's token account back to the seller after the deposit", async () => {
    const { conn, sent } = fakeConn();
    const d = chain(conn);
    await dyingShop(d, Keypair.generate().publicKey);
    const last = sent[1]!.instructions.at(-1)!;
    expect(last.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(last.data[0]).toBe(9); // CloseAccount
    expect(last.keys[1]!.pubkey.equals(d.seller.publicKey)).toBe(true);
  });

  it("adds the margin and reads each rent once per connection", async () => {
    const { conn, rentReads } = fakeConn();
    const d = chain(conn, rent(0));
    const base = rent(300) + rent(ACCOUNT_SIZE) + rent(182);
    expect(await dyingShopLamports(d)).toBe(base + rent(0));
    await dyingShopLamports(d);
    expect(rentReads.length).toBe(4);
  });

  it("rejects a margin that would leave the owner below the rent of an empty account", async () => {
    const { conn } = fakeConn();
    await expect(dyingShopLamports(chain(conn, 1000))).rejects.toThrow(/marginLamports/);
  });
});

