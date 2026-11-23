import { utils, type Idl } from "@anchor-lang/core";
import { KEKAL_IDL } from "./program";

/** Byte layout of fixed-size account fields, read from the IDL, for getProgramAccounts memcmp filters. */

const PRIMITIVE: Record<string, number> = { bool: 1, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16, pubkey: 32 };
const DISCRIMINATOR_BYTES = 8;

type IdlTypeDef = NonNullable<Idl["types"]>[number];
type FieldType = unknown;

function sizeOf(t: FieldType, types: IdlTypeDef[]): number {
  if (typeof t === "string") {
    const n = PRIMITIVE[t];
    if (n === undefined) throw new Error(`variable-size or unknown type ${t}`);
    return n;
  }
  const o = t as { array?: [FieldType, number]; defined?: { name: string } };
  if (o.array) return sizeOf(o.array[0], types) * o.array[1];
  if (o.defined) return structSize(o.defined.name, types);
  throw new Error(`unsupported type ${JSON.stringify(t)}`);
}

function fieldsOf(name: string, types: IdlTypeDef[]) {
  const def = types.find((x) => x.name === name);
  const ty = def?.type as { kind?: string; fields?: { name: string; type: FieldType }[] } | undefined;
  if (ty?.kind !== "struct" || !ty.fields) throw new Error(`IDL has no struct ${name}`);
  return ty.fields;
}

function structSize(name: string, types: IdlTypeDef[]): number {
  return fieldsOf(name, types).reduce((n, f) => n + sizeOf(f.type, types), 0);
}

function camel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Offset of `field` (snake or camel case) in account `account` (IDL type name, e.g. "Warranty"), discriminator included. */
export function accountFieldOffset(account: string, field: string, idl: Idl = KEKAL_IDL): number {
  const types = idl.types ?? [];
  let offset = DISCRIMINATOR_BYTES;
  for (const f of fieldsOf(account, types)) {
    if (camel(f.name) === camel(field)) return offset;
    offset += sizeOf(f.type, types);
  }
  throw new Error(`account ${account} has no field ${field}`);
}

/** memcmp filter: the account discriminator. */
export function discriminatorFilter(account: string, idl: Idl = KEKAL_IDL) {
  const acc = (idl.accounts ?? []).find((a) => a.name === account);
  if (!acc) throw new Error(`IDL has no account ${account}`);
  return { memcmp: { offset: 0, bytes: utils.bytes.bs58.encode(Uint8Array.from(acc.discriminator)) } };
}

/** memcmp filter: a one-byte field (a status code) equals `value`. */
export function byteFieldFilter(account: string, field: string, value: number, idl: Idl = KEKAL_IDL) {
  return { memcmp: { offset: accountFieldOffset(account, field, idl), bytes: utils.bytes.bs58.encode(Uint8Array.of(value)) } };
}
