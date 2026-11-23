// POST /api/relay behind the route: policy, rate limits, relayer signature, send. Network and keys are injected.
import type { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { DataStore } from "../data/store";
import { checkRelayTx, type RelayPolicy, type RelayRefusal } from "./policy";

export interface RelayLimits {
  perHolderPerHour: number;
  perIpPerHour: number;
  globalPerDay: number;
  /** Associated accounts the relayer pays rent for, all callers, per day. */
  accountCreatesPerDay: number;
}

export type RelayError = RelayRefusal | "bad_request" | "rate_ip" | "rate_holder" | "rate_global" | "rate_accounts" | "send_failed";

export type RelayResult = { ok: true; signature: string } | { ok: false; status: number; error: RelayError; detail?: string };

export interface RelayDeps {
  store: DataStore;
  policy: RelayPolicy;
  limits: RelayLimits;
  relayer: Keypair;
  /** Sends a fully signed transaction; resolves to its signature or rejects with the RPC message. */
  send: (tx: VersionedTransaction) => Promise<string>;
  now: number;
}

const HOUR = 3600;
const DAY = 86400;

/** Counts the hit in every bucket, then reports the first bucket over its limit (so a refused caller still spends quota). */
export function overLimit(
  store: DataStore,
  limits: RelayLimits,
  ip: string,
  holders: string[],
  now: number,
  accountCreates = 0,
): "rate_ip" | "rate_holder" | "rate_global" | "rate_accounts" | null {
  if (store.hit(`relay:ip:${ip}`, HOUR, now) > limits.perIpPerHour) return "rate_ip";
  let holderOver = false;
  for (const h of holders) if (store.hit(`relay:holder:${h}`, HOUR, now) > limits.perHolderPerHour) holderOver = true;
  if (holderOver) return "rate_holder";
  if (store.hit("relay:global", DAY, now) > limits.globalPerDay) return "rate_global";
  let accountsOver = false;
  for (let i = 0; i < accountCreates; i++) if (store.hit("relay:accounts", DAY, now) > limits.accountCreatesPerDay) accountsOver = true;
  if (accountsOver) return "rate_accounts";
  return null;
}

export async function relay(body: unknown, ip: string, deps: RelayDeps): Promise<RelayResult> {
  const tx64 = (body as { tx?: unknown } | null)?.tx;
  if (typeof tx64 !== "string") return { ok: false, status: 400, error: "bad_request" };
  const verdict = checkRelayTx(tx64, deps.policy);
  if (!verdict.ok) return { ok: false, status: 400, error: verdict.error };
  const limited = overLimit(deps.store, deps.limits, ip, verdict.signers, deps.now, verdict.accountCreates);
  if (limited) return { ok: false, status: 429, error: limited };
  verdict.tx.sign([deps.relayer]);
  try {
    return { ok: true, signature: await deps.send(verdict.tx) };
  } catch (e) {
    return { ok: false, status: 502, error: "send_failed", detail: (e as Error).message.slice(0, 300) };
  }
}
