// What the relayer agrees to pay for (PRD 4.3). Pure: no network, no clock, no keys. Every refusal is a short code
// the UI maps to locale text.
import { KEKAL_IDL } from "@kekal/sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import { verifyEd25519 } from "../ed25519";

export interface RelayPolicy {
  programId: PublicKey;
  relayer: PublicKey;
  allowedMints: PublicKey[];
  /** IDL (snake_case) names of the Kekal instructions the relayer pays for. */
  allowedInstructions: string[];
  /** Dotted IDL account paths where the relayer key may stand (rent payer slots). */
  payerAccounts: string[];
  maxInstructions: number;
  /** Signatures in one transaction, the relayer's included; the relayer pays the fee for each. */
  maxSigners: number;
  /** Associated-account creations (relayer pays the rent) allowed in one transaction. */
  maxAccountCreates: number;
  maxTxBytes: number;
}

export type RelayRefusal =
  | "malformed"
  | "too_large"
  | "lookup_tables"
  | "fee_payer"
  | "no_instructions"
  | "too_many_instructions"
  | "program_not_allowed"
  | "instruction_not_allowed"
  | "relayer_misuse"
  | "mint_not_allowed"
  | "bad_account"
  | "missing_signature"
  | "bad_signature"
  | "no_holder_signer"
  | "too_many_signers"
  | "bad_amount"
  | "unpaired_account"
  | "too_many_account_creates";

export type Verdict =
  /** `accountCreates` = accounts the relayer pays rent for: associated accounts it creates directly plus each Kekal
   * instruction that names it as rent payer (a claim record, or a holder's account a payout may create). */
  | { ok: true; tx: VersionedTransaction; signers: string[]; accountCreates: number }
  | { ok: false; error: RelayRefusal; index?: number };

interface IdlAccountNode {
  name: string;
  accounts?: IdlAccountNode[];
}

function flatten(nodes: IdlAccountNode[], prefix = ""): string[] {
  return nodes.flatMap((n) => (n.accounts ? flatten(n.accounts, `${prefix}${n.name}.`) : [`${prefix}${n.name}`]));
}

interface KekalIx {
  name: string;
  accounts: string[];
}

/** Discriminator (hex of the first 8 data bytes) -> instruction name + flattened account paths. */
const KEKAL_BY_DISC: Map<string, KekalIx> = new Map(
  (KEKAL_IDL.instructions as unknown as { name: string; discriminator: number[]; accounts: IdlAccountNode[] }[]).map((i) => [
    Buffer.from(i.discriminator).toString("hex"),
    { name: i.name, accounts: flatten(i.accounts) },
  ]),
);

const TOKEN_TRANSFER_CHECKED = 12;
const TRANSFER_CHECKED_DATA = 10; // tag, u64 amount, u8 decimals
const ATA_CREATE = 0;
const ATA_CREATE_IDEMPOTENT = 1;

function decode(base64: string): Uint8Array | null {
  if (typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

function hasMint(policy: RelayPolicy, mint: PublicKey): boolean {
  return policy.allowedMints.some((m) => m.equals(mint));
}

/** Checks a holder-signed transaction against the relay policy. On success `signers` = every signer except the relayer. */
export function checkRelayTx(base64: string, policy: RelayPolicy): Verdict {
  const raw = decode(base64);
  if (!raw) return { ok: false, error: "malformed" };
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
  const nSigners = msg.header.numRequiredSignatures;
  if (!keys[0]?.equals(policy.relayer)) return { ok: false, error: "fee_payer" };
  // The relayer never signs alone: someone else's key carries the per-holder limit and stands behind the request.
  if (nSigners < 2) return { ok: false, error: "no_holder_signer" };
  if (nSigners > policy.maxSigners) return { ok: false, error: "too_many_signers" };
  if (keys.slice(1).some((k) => k.equals(policy.relayer))) return { ok: false, error: "relayer_misuse" };
  const ixs = msg.compiledInstructions;
  if (ixs.length === 0) return { ok: false, error: "no_instructions" };
  if (ixs.length > policy.maxInstructions) return { ok: false, error: "too_many_instructions" };

  const isRelayer = (i: number) => i === 0;
  const isSigner = (i: number) => i < nSigners;
  // Associated accounts the relayer pays rent for, and the token accounts this transaction sends a real amount to.
  const creates: { ata: PublicKey; index: number }[] = [];
  const fundedDestinations: PublicKey[] = [];
  // Kekal instructions with the relayer in a rent-payer slot. The program never closes those accounts, so each one is
  // rent the relayer does not get back; they count against the same daily budget as direct creations.
  let rentSlots = 0;

  for (const [index, ix] of ixs.entries()) {
    const program = keys[ix.programIdIndex];
    if (!program) return { ok: false, error: "malformed", index };
    const acc = ix.accountKeyIndexes;
    const data = ix.data;
    const key = (pos: number): PublicKey | undefined => keys[acc[pos] ?? -1];

    if (program.equals(policy.programId)) {
      const meta = KEKAL_BY_DISC.get(Buffer.from(data.subarray(0, 8)).toString("hex"));
      if (!meta || !policy.allowedInstructions.includes(meta.name)) return { ok: false, error: "instruction_not_allowed", index };
      let paysRent = false;
      for (const [pos, k] of acc.entries()) {
        if (!isRelayer(k)) continue;
        if (!policy.payerAccounts.includes(meta.accounts[pos] ?? "")) return { ok: false, error: "relayer_misuse", index };
        paysRent = true;
      }
      if (paysRent) rentSlots++;
      continue;
    }

    if (program.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const kind = data.length === 0 ? ATA_CREATE : data[0];
      if (data.length > 1 || (kind !== ATA_CREATE && kind !== ATA_CREATE_IDEMPOTENT)) {
        return { ok: false, error: "instruction_not_allowed", index };
      }
      if (acc.length !== 6) return { ok: false, error: "bad_account", index };
      if (acc.slice(1).some(isRelayer)) return { ok: false, error: "relayer_misuse", index };
      const [ata, owner, mint, system, token] = [key(1), key(2), key(3), key(4), key(5)];
      if (!ata || !owner || !mint || !system || !token) return { ok: false, error: "malformed", index };
      if (!hasMint(policy, mint)) return { ok: false, error: "mint_not_allowed", index };
      if (!system.equals(SystemProgram.programId) || !token.equals(TOKEN_PROGRAM_ID)) return { ok: false, error: "bad_account", index };
      if (!ata.equals(getAssociatedTokenAddressSync(mint, owner, true))) return { ok: false, error: "bad_account", index };
      creates.push({ ata, index });
      continue;
    }

    if (program.equals(TOKEN_PROGRAM_ID)) {
      if (data[0] !== TOKEN_TRANSFER_CHECKED) return { ok: false, error: "instruction_not_allowed", index };
      // Exactly [source, mint, destination, authority]: no multisig signers, the authority signs itself.
      if (acc.length !== 4) return { ok: false, error: "bad_account", index };
      if (acc.some(isRelayer)) return { ok: false, error: "relayer_misuse", index };
      if (data.length !== TRANSFER_CHECKED_DATA) return { ok: false, error: "malformed", index };
      if (Buffer.from(data).readBigUInt64LE(1) === 0n) return { ok: false, error: "bad_amount", index };
      const [source, mint, destination, authority] = [key(0), key(1), key(2), key(3)];
      if (!source || !mint || !destination || !authority) return { ok: false, error: "malformed", index };
      if (!isSigner(acc[3]!)) return { ok: false, error: "missing_signature", index };
      if (!hasMint(policy, mint)) return { ok: false, error: "mint_not_allowed", index };
      if (!source.equals(getAssociatedTokenAddressSync(mint, authority, true))) return { ok: false, error: "bad_account", index };
      fundedDestinations.push(destination);
      continue;
    }

    return { ok: false, error: "program_not_allowed", index };
  }

  // Kekal payouts create the holder's account inside the program, so the only rent the relayer pays directly is for
  // the account a holder sends to. An account nobody sends to could be closed by its owner for the rent: refused.
  if (creates.length > policy.maxAccountCreates) return { ok: false, error: "too_many_account_creates" };
  for (const c of creates) {
    if (!fundedDestinations.some((d) => d.equals(c.ata))) return { ok: false, error: "unpaired_account", index: c.index };
  }

  // Every signer but the relayer must already have signed this exact message.
  const message = msg.serialize();
  for (let i = 1; i < nSigners; i++) {
    const sig = tx.signatures[i];
    const signer = keys[i];
    if (!sig || !signer || sig.every((b) => b === 0)) return { ok: false, error: "missing_signature" };
    if (!verifyEd25519(signer.toBytes(), message, sig)) return { ok: false, error: "bad_signature" };
  }
  return { ok: true, tx, signers: keys.slice(1, nSigners).map((k) => k.toBase58()), accountCreates: creates.length + rentSlots };
}
