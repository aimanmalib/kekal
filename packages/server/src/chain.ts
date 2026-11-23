// Signing and sending for server-held keys. Confirmation polls signature status over HTTP (no websocket), so it
// works through the failover connection.
import { Transaction, type Connection, type Keypair, type TransactionInstruction } from "@solana/web3.js";

export interface SendOptions {
  /** Poll interval while waiting for confirmation. */
  pollMs?: number;
  /** Gives up after this long even if the blockhash is still valid. */
  timeoutMs?: number;
}

export class SendError extends Error {
  constructor(
    message: string,
    readonly logs: string[] = [],
  ) {
    super(message);
  }
}

/** Builds, signs (fee payer first), sends and waits for `confirmed`. Throws SendError with the program logs on failure. */
export async function sendSigned(
  conn: Connection,
  feePayer: Keypair,
  ixs: TransactionInstruction[],
  signers: Keypair[] = [],
  opts: SendOptions = {},
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  const unique = [feePayer, ...signers.filter((s) => !s.publicKey.equals(feePayer.publicKey))];
  tx.sign(...unique);
  let sig: string;
  try {
    sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  } catch (e) {
    const logs = (e as { logs?: string[] }).logs ?? [];
    throw new SendError((e as Error).message, logs);
  }
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  for (;;) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value[0];
    if (st?.err) throw new SendError(`transaction ${sig} failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig;
    if (Date.now() > deadline || (await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      throw new SendError(`transaction ${sig} was not confirmed in time`);
    }
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 800));
  }
}

/** Anchor error name from program logs or an error message, e.g. "ClaimNotPending"; null when none. */
export function programErrorName(e: unknown): string | null {
  const parts = [(e as Error)?.message ?? "", ...(((e as SendError)?.logs ?? []) as string[])];
  for (const p of parts) {
    const m = /Error Code: (\w+)/.exec(p);
    if (m) return m[1]!;
  }
  return null;
}
