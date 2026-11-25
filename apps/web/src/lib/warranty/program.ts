// The Anchor side of the browser: instruction building and account layouts. Kept apart from ./client so pages load it
// only when an action is built (the warranty page imports it on demand).
import { accountFieldOffset, readOnlyProgram, type KekalProgram } from "@kekal/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { ActionError, fromBase64, rpc } from "./client";

/** Instructions are built offline; this connection is never called (the browser talks to /api/rpc and /api/relay). */
let offline: KekalProgram | undefined;
export function clientProgram(programId: string): KekalProgram {
  if (!offline || offline.programId.toBase58() !== programId) {
    offline = readOnlyProgram(new Connection("http://127.0.0.1:9"), new PublicKey(programId));
  }
  return offline;
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
