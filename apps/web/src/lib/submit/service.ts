// POST /api/submit behind the route: policy, per-IP limit, send. Network is injected.
import type { VersionedTransaction } from "@solana/web3.js";
import type { DataStore } from "@kekal/server";
import { checkSubmitTx, type SubmitPolicy, type SubmitRefusal } from "./policy";

export type SubmitError = SubmitRefusal | "bad_request" | "rate_ip" | "send_failed";
export type SubmitResult = { ok: true; signature: string } | { ok: false; status: number; error: SubmitError; detail?: string };

export interface SubmitDeps {
  store: Pick<DataStore, "hit">;
  policy: SubmitPolicy;
  perIpPerHour: number;
  send: (tx: VersionedTransaction) => Promise<string>;
  now: number;
}

export async function submit(body: unknown, ip: string, deps: SubmitDeps): Promise<SubmitResult> {
  const tx64 = (body as { tx?: unknown } | null)?.tx;
  if (typeof tx64 !== "string") return { ok: false, status: 400, error: "bad_request" };
  if (deps.store.hit(`submit:ip:${ip}`, 3600, deps.now) > deps.perIpPerHour) return { ok: false, status: 429, error: "rate_ip" };
  const verdict = checkSubmitTx(tx64, deps.policy);
  if (!verdict.ok) return { ok: false, status: 400, error: verdict.error };
  try {
    return { ok: true, signature: await deps.send(verdict.tx) };
  } catch (e) {
    // The RPC's own words (for example "insufficient funds") help the seller; they never contain server data.
    return { ok: false, status: 502, error: "send_failed", detail: (e as Error).message.slice(0, 300) };
  }
}
