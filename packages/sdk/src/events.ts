import { EventParser, utils } from "@anchor-lang/core";
import type { KekalProgram } from "./program";

/** A Kekal event decoded from transaction logs, with BN fields left as the coder returns them. */
export interface KekalEvent {
  name: string;
  data: Record<string, unknown>;
}

/** Events the Kekal program emitted in one transaction, in log order, named as in the IDL (`ReservePaid`). */
export function parseKekalEvents(program: KekalProgram, logs: readonly string[]): KekalEvent[] {
  const parser = new EventParser(program.programId, program.coder);
  const out: KekalEvent[] = [];
  for (const e of parser.parseLogs([...logs])) out.push({ name: e.name.charAt(0).toUpperCase() + e.name.slice(1), data: e.data as Record<string, unknown> });
  return out;
}

/** Base58 (Bitcoin alphabet), as used for Solana keys and signatures. */
export const base58 = utils.bytes.bs58;
