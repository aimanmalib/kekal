import { createPublicKey, verify, type KeyObject } from "node:crypto";

// SPKI DER prefix of a raw 32-byte Ed25519 public key (RFC 8410).
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function publicKey(raw: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(raw)]), format: "der", type: "spki" });
}

/** True when `signature` (64 bytes) is a valid Ed25519 signature of `message` by the 32-byte `pubkey`. Never throws. */
export function verifyEd25519(pubkey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (pubkey.length !== 32 || signature.length !== 64) return false;
  try {
    return verify(null, message, publicKey(pubkey), signature);
  } catch {
    return false;
  }
}
