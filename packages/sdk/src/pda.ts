import { PublicKey } from "@solana/web3.js";

/** PDA seed prefixes. They must match `programs/kekal/src/constants.rs` (checked against the IDL in tests). */
export const SEEDS = {
  config: "config",
  shop: "shop",
  vault: "vault",
  warranty: "warranty",
  claim: "claim",
} as const;

const enc = new TextEncoder();

export function u64le(value: bigint | number): Uint8Array {
  const v = BigInt(value);
  if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new RangeError("u64 out of range");
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}

export function u16le(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError("u16 out of range");
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function find(programId: PublicKey, seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export function configPda(programId: PublicKey): PublicKey {
  return find(programId, [enc.encode(SEEDS.config)]);
}

/** One shop per owner key. */
export function shopPda(programId: PublicKey, owner: PublicKey): PublicKey {
  return find(programId, [enc.encode(SEEDS.shop), owner.toBytes()]);
}

/** Token account owned by the shop PDA that holds free and locked funds. */
export function vaultPda(programId: PublicKey, shop: PublicKey): PublicKey {
  return find(programId, [enc.encode(SEEDS.vault), shop.toBytes()]);
}

export function warrantyPda(programId: PublicKey, shop: PublicKey, id: bigint | number): PublicKey {
  return find(programId, [enc.encode(SEEDS.warranty), shop.toBytes(), u64le(id)]);
}

export function claimPda(programId: PublicKey, warranty: PublicKey, index: number): PublicKey {
  return find(programId, [enc.encode(SEEDS.claim), warranty.toBytes(), u16le(index)]);
}
