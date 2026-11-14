import type BN from "bn.js";
import type { PublicKey } from "@solana/web3.js";
import type { KekalProgram } from "./program";
import { configPda } from "./pda";

/** Decoded accounts with u64 amounts as bigint and i64 times as number (unix seconds). */
export interface ConfigLimits {
  minResponseSecs: number;
  maxResponseSecs: number;
  minRepairSecs: number;
  maxRepairSecs: number;
  minDisputeSecs: number;
  maxDisputeSecs: number;
  minHeartbeatSecs: number;
  maxHeartbeatSecs: number;
  maxGraceSecs: number;
  minTermSecs: number;
  maxTermSecs: number;
  disputeTimeoutSecs: number;
  claimCooldownSecs: number;
  maxClaimsPerWarranty: number;
}
export interface ConfigAccount {
  admin: PublicKey;
  defaultArbiter: PublicKey;
  assessor: PublicKey;
  limits: ConfigLimits;
  allowedMints: PublicKey[];
  paused: boolean;
}
export interface ShopAccount {
  owner: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  arbiter: PublicKey;
  freeBalance: bigint;
  lockedBalance: bigint;
  responseSecs: number;
  repairSecs: number;
  disputeSecs: number;
  heartbeatSecs: number;
  graceSecs: number;
  lastSeen: number;
  status: number;
  dormantAt: number;
  nextWarrantyId: bigint;
  activeWarranties: number;
  openClaims: number;
  issued: bigint;
  paidCount: bigint;
  paidAmount: bigint;
  releasedAmount: bigint;
  flags: number;
  profileHash: Uint8Array;
  createdAt: number;
}
export interface WarrantyAccount {
  shop: PublicKey;
  id: bigint;
  holder: PublicKey;
  reserve: bigint;
  termsHash: Uint8Array;
  productHash: Uint8Array;
  issuedAt: number;
  expiresAt: number;
  status: number;
  claimCount: number;
  openClaim: number;
  lastClaimClosedAt: number;
}
export interface ClaimAccount {
  warranty: PublicKey;
  index: number;
  evidenceHash: Uint8Array;
  filedAt: number;
  status: number;
  responseHash: Uint8Array;
  respondedAt: number;
  repairDeadline: number;
  disputeDeadline: number;
  escalatedAt: number;
  attestVerdict: number;
  attestAt: number;
  rentPayer: PublicKey;
}

export type AccountName = "config" | "shop" | "warranty" | "claim";
type Raw = Record<string, unknown>;

const U64 = new Set(["freeBalance", "lockedBalance", "nextWarrantyId", "issued", "paidCount", "paidAmount", "releasedAmount", "id", "reserve"]);
const DROP = new Set(["bump", "vaultBump"]);

function isBn(v: unknown): v is BN {
  return typeof v === "object" && v !== null && "toArray" in v && "isNeg" in v;
}

/** BN → bigint for u64 amounts/ids, number for i64 times; byte arrays → Uint8Array. */
function normalise(raw: Raw): Raw {
  const out: Raw = {};
  for (const [k, v] of Object.entries(raw)) {
    if (DROP.has(k)) continue;
    if (isBn(v)) out[k] = U64.has(k) ? BigInt(v.toString()) : v.toNumber();
    else if (Array.isArray(v) && v.every((x) => typeof x === "number")) out[k] = Uint8Array.from(v);
    else if (k === "limits") out[k] = normalise(v as Raw);
    else out[k] = v;
  }
  return out;
}

export function decodeAccount<T>(program: KekalProgram, name: AccountName, data: Buffer): T {
  return normalise(program.coder.accounts.decode(name, data)) as T;
}

async function fetchAs<T>(program: KekalProgram, name: AccountName, address: PublicKey): Promise<T | null> {
  const ns = program.account as unknown as Record<string, { fetchNullable(a: PublicKey): Promise<unknown> }>;
  const client = ns[name];
  if (!client) throw new Error(`IDL has no account ${name}`);
  const raw = await client.fetchNullable(address);
  return raw ? (normalise(raw as Raw) as T) : null;
}

export const fetchConfig = (p: KekalProgram) => fetchAs<ConfigAccount>(p, "config", configPda(p.programId));
export const fetchShop = (p: KekalProgram, a: PublicKey) => fetchAs<ShopAccount>(p, "shop", a);
export const fetchWarranty = (p: KekalProgram, a: PublicKey) => fetchAs<WarrantyAccount>(p, "warranty", a);
export const fetchClaim = (p: KekalProgram, a: PublicKey) => fetchAs<ClaimAccount>(p, "claim", a);
