import { Program, type Idl, type Provider } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import idlJson from "./idl/kekal.json" with { type: "json" };

/** IDL produced by `anchor build`, copied by `scripts/sync-idl.sh`. Not typed (KP: no generated `.ts`). */
export const KEKAL_IDL = idlJson as Idl;
export const IDL_PROGRAM_ID = new PublicKey(KEKAL_IDL.address);

export type KekalProgram = Program<Idl>;

/** `programId` overrides the IDL address (e.g. a devnet deployment under another key). */
export function kekalProgram(provider: Provider, programId?: PublicKey): KekalProgram {
  const idl = programId ? { ...KEKAL_IDL, address: programId.toBase58() } : KEKAL_IDL;
  return new Program(idl, provider);
}

/** A program handle for reads and instruction building; it never signs. */
export function readOnlyProgram(connection: Connection, programId?: PublicKey): KekalProgram {
  return kekalProgram({ connection } as Provider, programId);
}
