// Shared builders for relay tests: real Kekal instructions from the SDK, signed with throwaway keys.
import { createPrivateKey, sign } from "node:crypto";
import { readOnlyProgram, IDL_PROGRAM_ID } from "@kekal/sdk";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type TransactionInstruction } from "@solana/web3.js";
import type { RelayPolicy } from "../src/lib/relay/policy";

export const program = readOnlyProgram(new Connection("http://127.0.0.1:9"));
export const relayer = Keypair.generate();
export const holder = Keypair.generate();
export const mint = Keypair.generate().publicKey;
export const shop = Keypair.generate().publicKey;
export const warranty = Keypair.generate().publicKey;
export const claim = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();

export function policy(over: Partial<RelayPolicy> = {}): RelayPolicy {
  return {
    programId: IDL_PROGRAM_ID,
    relayer: relayer.publicKey,
    allowedMints: [mint],
    allowedInstructions: [
      "transfer_holder", "file_claim", "confirm_resolved", "escalate", "settle_unanswered",
      "close_stale", "settle_stale_dispute", "declare_dormant", "claim_orphan", "release_expired",
    ],
    payerAccounts: ["payer", "payout.payer"],
    maxInstructions: 4,
    maxSigners: 3,
    maxAccountCreates: 1,
    maxTxBytes: 1232,
    ...over,
  };
}

export function build(
  ixs: TransactionInstruction[],
  signers: Keypair[],
  opts: { payer?: PublicKey; tables?: AddressLookupTableAccount[] } = {},
): VersionedTransaction {
  const message = new TransactionMessage({ payerKey: opts.payer ?? relayer.publicKey, recentBlockhash: blockhash, instructions: ixs })
    .compileToV0Message(opts.tables);
  const tx = new VersionedTransaction(message);
  if (signers.length) tx.sign(signers);
  return tx;
}

/** Names `kp` as an extra read-only signer, the way a caller co-signs a permissionless instruction (Anchor ignores it). */
export function withCaller(i: TransactionInstruction, kp: Keypair): TransactionInstruction {
  i.keys.push({ pubkey: kp.publicKey, isSigner: true, isWritable: false });
  return i;
}

export const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

/** Ed25519 signature with a solana Keypair, via node:crypto (wallet signMessage equivalent). */
export function signBytes(kp: Keypair, message: Uint8Array): Uint8Array {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(kp.secretKey.subarray(0, 32))]);
  return sign(null, message, createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
}
