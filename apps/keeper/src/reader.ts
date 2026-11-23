// ChainReader over a live connection.
import { fetchConfig, type KekalProgram } from "@kekal/sdk";
import { SYSVAR_CLOCK_PUBKEY, type Connection } from "@solana/web3.js";
import type { ChainReader } from "./pass";
import { loadLiveWarranties, loadShops } from "./scan";

/** `Clock.unix_timestamp` sits after slot, epoch_start_timestamp, epoch and leader_schedule_epoch (4 × 8 bytes). */
const CLOCK_UNIX_TS_OFFSET = 32;

export async function chainClock(conn: Connection): Promise<number> {
  const info = await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  if (!info) throw new Error("clock sysvar unavailable");
  return Number(info.data.readBigInt64LE(CLOCK_UNIX_TS_OFFSET));
}

export function liveReader(conn: Connection, program: KekalProgram): ChainReader {
  return {
    shops: () => loadShops(conn, program),
    liveWarranties: () => loadLiveWarranties(conn, program),
    disputeTimeoutSecs: async () => {
      const config = await fetchConfig(program);
      if (!config) throw new Error("Config account missing: run seed-demo");
      return config.limits.disputeTimeoutSecs;
    },
    clock: () => chainClock(conn),
  };
}
