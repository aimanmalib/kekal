import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import BN from "bn.js";
import { accountFieldOffset, byteFieldFilter, discriminatorFilter } from "../src/layout";
import { readOnlyProgram } from "../src/program";
import { Connection } from "@solana/web3.js";

const program = readOnlyProgram(new Connection("http://127.0.0.1:1"));

async function encodedWarranty(status: number): Promise<Buffer> {
  const k = () => Keypair.generate().publicKey;
  return program.coder.accounts.encode("warranty", {
    shop: k(),
    id: new BN(7),
    holder: k(),
    reserve: new BN(25),
    termsHash: Array(32).fill(1),
    productHash: Array(32).fill(2),
    issuedAt: new BN(100),
    expiresAt: new BN(200),
    status,
    claimCount: 3,
    openClaim: 2,
    lastClaimClosedAt: new BN(0),
    bump: 254,
  });
}

describe("account layout from the IDL", () => {
  it("status offset points at the status byte of an encoded warranty", async () => {
    const off = accountFieldOffset("Warranty", "status");
    const data = await encodedWarranty(1);
    expect(data[off]).toBe(1);
    expect((await encodedWarranty(3))[off]).toBe(3);
  });
  it("accepts snake_case names and rejects unknown fields", () => {
    expect(accountFieldOffset("Warranty", "expires_at")).toBe(accountFieldOffset("Warranty", "expiresAt"));
    expect(() => accountFieldOffset("Warranty", "nope")).toThrow(/no field/);
    expect(() => accountFieldOffset("Nope", "status")).toThrow(/no struct/);
  });
  it("shop status offset matches an encoded shop", async () => {
    const off = accountFieldOffset("Shop", "status");
    expect(off).toBeGreaterThan(8);
    const f = byteFieldFilter("Shop", "status", 1);
    expect(f.memcmp.offset).toBe(off);
    expect(f.memcmp.bytes).toBe("2"); // base58 of a single 0x01 byte
  });
  it("discriminator filter is the first 8 bytes of an encoded account", async () => {
    const data = await encodedWarranty(0);
    const f = discriminatorFilter("Warranty");
    expect(f.memcmp.offset).toBe(0);
    const { utils } = await import("@anchor-lang/core");
    expect(utils.bytes.bs58.encode(data.subarray(0, 8))).toBe(f.memcmp.bytes);
  });
});
