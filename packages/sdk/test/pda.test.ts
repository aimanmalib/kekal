import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  claimPda,
  configPda,
  IDL_PROGRAM_ID,
  KEKAL_IDL,
  readOnlyProgram,
  SEEDS,
  shopPda,
  u16le,
  u64le,
  vaultPda,
  warrantyPda,
} from "../src";
import { Connection } from "@solana/web3.js";

const program = readOnlyProgram(new Connection("http://127.0.0.1:1"));
const pid = program.programId;

type Seed = { kind: string; value?: number[]; path?: string };
type IdlAccount = { name: string; pda?: { seeds: Seed[] }; accounts?: IdlAccount[] };

/** Every const seed the program declares, by account name. */
function constSeeds(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const visit = (a: IdlAccount) => {
    a.accounts?.forEach(visit);
    const first = a.pda?.seeds[0];
    if (first?.kind === "const" && first.value) {
      const text = Buffer.from(first.value).toString("latin1");
      if (!out.has(a.name)) out.set(a.name, new Set());
      out.get(a.name)!.add(text);
    }
  };
  for (const ix of KEKAL_IDL.instructions) (ix.accounts as IdlAccount[]).forEach(visit);
  return out;
}

describe("PDA seeds", () => {
  it("match the seeds declared in the IDL", () => {
    const seeds = constSeeds();
    for (const name of ["config", "shop", "vault", "warranty", "claim"] as const) {
      expect([...(seeds.get(name) ?? [])]).toEqual([SEEDS[name]]);
    }
  });

  it("use the IDL program id by default", () => {
    expect(pid.equals(IDL_PROGRAM_ID)).toBe(true);
  });

  it("agree with Anchor's resolution from the IDL", async () => {
    const owner = Keypair.generate().publicKey;
    const keys = await program.methods.heartbeat!().accounts({ owner }).pubkeys();
    expect((keys.shop as PublicKey).equals(shopPda(pid, owner))).toBe(true);

    const mint = Keypair.generate().publicKey;
    const created = await program.methods.createShop!(
      { responseSecs: 1, repairSecs: 1, disputeSecs: 1, heartbeatSecs: 1, graceSecs: 0 } as never,
      null,
      new Array(32).fill(0),
    )
      .accounts({ owner, mint })
      .pubkeys();
    const shop = shopPda(pid, owner);
    expect((created.shop as PublicKey).equals(shop)).toBe(true);
    expect((created.vault as PublicKey).equals(vaultPda(pid, shop))).toBe(true);
    expect((created.config as PublicKey).equals(configPda(pid))).toBe(true);
  });

  it("encode ids little-endian and differ per id and index", () => {
    expect(Array.from(u64le(258n))).toEqual([2, 1, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(u16le(258))).toEqual([2, 1]);
    expect(() => u64le(-1n)).toThrow(RangeError);
    expect(() => u16le(65536)).toThrow(RangeError);
    const shop = shopPda(pid, Keypair.generate().publicKey);
    const w0 = warrantyPda(pid, shop, 0n);
    expect(w0.equals(warrantyPda(pid, shop, 1n))).toBe(false);
    expect(claimPda(pid, w0, 0).equals(claimPda(pid, w0, 1))).toBe(false);
    const manual = PublicKey.findProgramAddressSync([Buffer.from("warranty"), shop.toBuffer(), u64le(0n)], pid)[0];
    expect(w0.equals(manual)).toBe(true);
  });
});
