import { sha256 } from "@noble/hashes/sha2.js";
import type { PublicKey } from "@solana/web3.js";
import { u16le } from "./pda";

const enc = new TextEncoder();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function canonicalString(s: string): string {
  if (!(s as string & { isWellFormed(): boolean }).isWellFormed()) {
    throw new TypeError("canonical JSON: string has a lone surrogate");
  }
  return JSON.stringify(s);
}

/**
 * Canonical JSON (RFC 8785 style): object keys sorted by UTF-16 code units, no whitespace,
 * ECMAScript number and string serialisation. Rejects values JSON cannot round-trip
 * (undefined, NaN, Infinity, bigint, functions, class instances) instead of dropping them.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonical JSON: non-finite number");
      return JSON.stringify(value);
    case "string":
      return canonicalString(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonical JSON: unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (!isPlainObject(value)) throw new TypeError("canonical JSON: only plain objects and arrays");
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${canonicalString(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

/** SHA-256 of the UTF-8 canonical JSON. Used for `terms_hash`, `evidence_hash`, `response_hash`. */
export function hashJson(value: unknown): Uint8Array {
  return sha256(enc.encode(canonicalJson(value)));
}

function field(text: string): Uint8Array {
  const bytes = enc.encode(text.normalize("NFC").trim());
  return new Uint8Array([...u16le(bytes.length), ...bytes]);
}

/**
 * `product_hash = sha256(shop ‖ serial ‖ model)`. Serial and model are NFC-normalised, trimmed and
 * length-prefixed (u16 LE) so that ("AB", "C") and ("A", "BC") never collide.
 */
export function productHash(shop: PublicKey, serial: string, model: string): Uint8Array {
  return sha256(new Uint8Array([...shop.toBytes(), ...field(serial), ...field(model)]));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/i.test(hex)) throw new TypeError("invalid hex");
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

export const ZERO_HASH: Uint8Array = new Uint8Array(32);
