// What POST /api/submit agrees to broadcast for a seller or arbiter wallet. The wallet pays its own fee and signs
// everything; the server adds nothing, so this only keeps the endpoint from being a general broadcast proxy.
// Pure: no network, no clock, no keys.
import { KEKAL_IDL } from "@kekal/sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { verifyEd25519 } from "../ed25519";

export interface SubmitPolicy {
  programId: PublicKey;
  /** Server keys that may not appear anywhere in the transaction. */
  forbiddenKeys: PublicKey[];
  /** IDL (snake_case) names of the Kekal instructions a wallet may send through here. */
  allowedInstructions: string[];
  maxInstructions: number;
  maxTxBytes: number;
}

export type SubmitRefusal =
  | "malformed"
  | "too_large"
  | "lookup_tables"
  | "no_instructions"
  | "too_many_instructions"
  | "no_kekal_instruction"
  | "program_not_allowed"
  | "instruction_not_allowed"
  | "server_key"
  | "missing_signature"
  | "bad_signature";

export type SubmitVerdict = { ok: true; tx: VersionedTransaction; feePayer: string } | { ok: false; error: SubmitRefusal; index?: number };

const NAME_BY_DISC: Map<string, string> = new Map(
  (KEKAL_IDL.instructions as unknown as { name: string; discriminator: number[] }[]).map((i) => [Buffer.from(i.discriminator).toString("hex"), i.name]),
);
const ATA_CREATE_IDEMPOTENT = 1;

export function checkSubmitTx(base64: unknown, policy: SubmitPolicy): SubmitVerdict {
  if (typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { ok: false, error: "malformed" };
  const raw = Uint8Array.from(Buffer.from(base64, "base64"));
  if (raw.length > policy.maxTxBytes) return { ok: false, error: "too_large" };
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(raw);
  } catch {
    return { ok: false, error: "malformed" };
  }
  const msg = tx.message;
  if (msg.addressTableLookups.length > 0) return { ok: false, error: "lookup_tables" };
  const keys = msg.staticAccountKeys;
  if (keys.some((k) => policy.forbiddenKeys.some((f) => f.equals(k)))) return { ok: false, error: "server_key" };
  const ixs = msg.compiledInstructions;
  if (ixs.length === 0) return { ok: false, error: "no_instructions" };
  if (ixs.length > policy.maxInstructions) return { ok: false, error: "too_many_instructions" };

  let kekal = 0;
  for (const [index, ix] of ixs.entries()) {
    const program = keys[ix.programIdIndex];
    if (!program) return { ok: false, error: "malformed", index };
    if (program.equals(policy.programId)) {
      const name = NAME_BY_DISC.get(Buffer.from(ix.data.subarray(0, 8)).toString("hex"));
      if (!name || !policy.allowedInstructions.includes(name)) return { ok: false, error: "instruction_not_allowed", index };
      kekal++;
      continue;
    }
    if (program.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (ix.data.length !== 1 || ix.data[0] !== ATA_CREATE_IDEMPOTENT) return { ok: false, error: "instruction_not_allowed", index };
      continue;
    }
    if (program.equals(ComputeBudgetProgram.programId)) continue;
    return { ok: false, error: "program_not_allowed", index };
  }
  if (kekal === 0) return { ok: false, error: "no_kekal_instruction" };

  const message = msg.serialize();
  for (let i = 0; i < msg.header.numRequiredSignatures; i++) {
    const sig = tx.signatures[i];
    const signer = keys[i];
    if (!sig || !signer || sig.every((b) => b === 0)) return { ok: false, error: "missing_signature" };
    if (!verifyEd25519(signer.toBytes(), message, sig)) return { ok: false, error: "bad_signature" };
  }
  return { ok: true, tx, feePayer: keys[0]!.toBase58() };
}
