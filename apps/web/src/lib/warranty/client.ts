// Browser side of /w/[pda]: the card key, transaction building and the relayer round trip.
// The card key lives in the URL fragment and in this browser's storage; it is never sent to the server.
import { accountFieldOffset, base58 as bs58, readOnlyProgram, type KekalProgram } from "@kekal/sdk";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";

/** The 32-byte seed in `#<param>=<base58>`, or null when absent or malformed. */
export function seedFromFragment(hash: string, param: string): Uint8Array | null {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  const value = new URLSearchParams(body).get(param);
  if (!value) return null;
  try {
    const bytes = bs58.decode(value);
    return bytes.length === 32 ? Uint8Array.from(bytes) : null;
  } catch {
    return null;
  }
}

export const encodeSeed = (seed: Uint8Array): string => bs58.encode(seed);

export function keypairFromSeed(seed: Uint8Array): Keypair {
  return Keypair.fromSeed(seed);
}

export function newSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** The card link for a seed: the fragment keeps the key out of server logs and referrers. */
export function cardLink(origin: string, pda: string, param: string, seed: Uint8Array): string {
  return `${origin}/w/${pda}#${param}=${encodeSeed(seed)}`;
}

/** Instructions are built offline; this connection is never called (the browser talks to /api/rpc and /api/relay). */
let offline: KekalProgram | undefined;
export function clientProgram(programId: string): KekalProgram {
  if (!offline || offline.programId.toBase58() !== programId) {
    offline = readOnlyProgram(new Connection("http://127.0.0.1:9"), new PublicKey(programId));
  }
  return offline;
}

export class ActionError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch {
    throw new ActionError("network");
  }
  const body = (await res.json().catch(() => null)) as { result?: T; error?: unknown } | null;
  if (body?.error !== undefined) throw new ActionError("rpc_error");
  if (!res.ok || !body || body.result === undefined) throw new ActionError("network");
  return body.result;
}

/** Signs with the holder key (the relayer adds its fee-payer signature) and returns the signature once confirmed. */
export async function sendViaRelay(
  ixs: TransactionInstruction[],
  relayer: string,
  signers: Keypair[],
  opts: { pollMs: number; timeoutMs: number },
): Promise<string> {
  const { value } = await rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const message = new TransactionMessage({ payerKey: new PublicKey(relayer), recentBlockhash: value.blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign(signers);
  let res: Response;
  try {
    res = await fetch("/api/relay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx: toBase64(tx.serialize()) }),
    });
  } catch {
    throw new ActionError("network");
  }
  const body = (await res.json().catch(() => ({}))) as { signature?: string; error?: string };
  if (!res.ok || !body.signature) throw new ActionError(body.error ?? "send_failed");
  return waitConfirmed(body.signature, opts);
}

/** Polls the signature until it is confirmed; a failed transaction or the timeout throws. */
export async function waitConfirmed(signature: string, opts: { pollMs: number; timeoutMs: number }): Promise<string> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    const st = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>("getSignatureStatuses", [[signature]]).catch(
      () => null,
    );
    const s = st?.value[0];
    if (s?.err) throw new ActionError("failed_on_chain");
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return signature;
    await new Promise((r) => setTimeout(r, opts.pollMs));
  }
  throw new ActionError("not_confirmed");
}

/** The current card holder as the chain sees it (confirmed): only the 32 holder bytes are fetched. Network trouble throws. */
export async function chainHolder(pda: string, programId: string): Promise<string> {
  const offset = accountFieldOffset("Warranty", "holder");
  const r = await rpc<{ value: { owner: string; data: [string, string] } | null }>("getAccountInfo", [
    pda,
    { encoding: "base64", commitment: "confirmed", dataSlice: { offset, length: 32 } },
  ]);
  if (!r.value || r.value.owner !== programId) throw new ActionError("network");
  return new PublicKey(fromBase64(r.value.data[0])).toBase58();
}

/** Base-unit balance of an associated token account, or 0 when it does not exist yet. Network trouble throws. */
export async function tokenBalance(account: string): Promise<bigint> {
  try {
    const r = await rpc<{ value: { amount: string } }>("getTokenAccountBalance", [account, { commitment: "confirmed" }]);
    return BigInt(r.value.amount);
  } catch (e) {
    if (e instanceof ActionError && e.code === "rpc_error") return 0n;
    throw e;
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
