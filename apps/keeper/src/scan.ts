// Reads the program's accounts for one keeper pass: all shops, live warranties (status filter), their open claims.
import {
  byteFieldFilter,
  claimPda,
  decodeAccount,
  discriminatorFilter,
  WarrantyStatus,
  type ClaimAccount,
  type KekalProgram,
  type ShopAccount,
  type WarrantyAccount,
} from "@kekal/sdk";
import type { Connection, PublicKey } from "@solana/web3.js";
import type { Keyed, LiveWarranty } from "./plan";

const BATCH = 100;

export async function loadShops(conn: Connection, program: KekalProgram): Promise<Keyed<ShopAccount>[]> {
  const raw = await conn.getProgramAccounts(program.programId, { filters: [discriminatorFilter("Shop")] });
  return raw.map((r) => ({ key: r.pubkey, account: decodeAccount<ShopAccount>(program, "shop", r.account.data) }));
}

async function warrantiesWithStatus(conn: Connection, program: KekalProgram, status: number) {
  const raw = await conn.getProgramAccounts(program.programId, {
    filters: [discriminatorFilter("Warranty"), byteFieldFilter("Warranty", "status", status)],
  });
  return raw.map((r) => ({ key: r.pubkey, account: decodeAccount<WarrantyAccount>(program, "warranty", r.account.data) }));
}

/** Active and Claimed warranties, each with its open claim when Claimed. */
export async function loadLiveWarranties(conn: Connection, program: KekalProgram): Promise<LiveWarranty[]> {
  const [active, claimed] = await Promise.all([
    warrantiesWithStatus(conn, program, WarrantyStatus.Active),
    warrantiesWithStatus(conn, program, WarrantyStatus.Claimed),
  ]);
  const claimKeys: PublicKey[] = claimed.map((w) => claimPda(program.programId, w.key, w.account.openClaim));
  const claims: (Keyed<ClaimAccount> | null)[] = [];
  for (let i = 0; i < claimKeys.length; i += BATCH) {
    const keys = claimKeys.slice(i, i + BATCH);
    const infos = await conn.getMultipleAccountsInfo(keys);
    infos.forEach((info, j) =>
      claims.push(info ? { key: keys[j]!, account: decodeAccount<ClaimAccount>(program, "claim", info.data) } : null),
    );
  }
  return [
    ...active.map((w) => ({ ...w, claim: null })),
    ...claimed.map((w, i) => ({ ...w, claim: claims[i] ?? null })),
  ];
}
