// Every button on /w/[pda] builds a transaction the relayer accepts, signed only by the key the page holds.
import { ClaimStatus, IDL_PROGRAM_ID, ShopStatus, WarrantyStatus, type PermissionlessAction } from "@kekal/sdk";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { checkRelayTx } from "../src/lib/relay/policy";
import { activateIxs, evidenceHash, fileClaimIxs, holderClaimIxs, sendIxs, settleIxs } from "../src/lib/warranty/actions";
import { b64, build, policy, program, relayer } from "./relay-fixtures";
import { claimAcc, keys, shopAcc, view, warrantyAcc } from "./warranty-fixtures";

const P = policy({ allowedMints: [keys.mint] });
const v = (over = {}) => ({ ...view(over), programId: IDL_PROGRAM_ID.toBase58() });
const claimed = () =>
  v({ warranty: warrantyAcc({ status: WarrantyStatus.Claimed, claimCount: 1 }), claim: claimAcc({ status: ClaimStatus.Accepted }) });
const accept = (ixs: Awaited<ReturnType<typeof activateIxs>>, signer: Keypair) => checkRelayTx(b64(build(ixs, [signer])), P);

describe("warranty page actions pass the relay policy", () => {
  it("activation: the card key hands over to a new key", async () => {
    const card = keys.holder;
    const r = accept(await activateIxs(program, v(), card.publicKey, Keypair.generate().publicKey), card);
    expect(r.ok && r.signers).toEqual([card.publicKey.toBase58()]);
  });

  it("file claim with the relayer paying rent", async () => {
    const r = accept(await fileClaimIxs(program, v(), relayer.publicKey, keys.holder.publicKey, evidenceHash("leak", "drips")), keys.holder);
    expect(r.ok).toBe(true);
  });

  it("confirm and escalate", async () => {
    for (const a of ["confirmResolved", "escalate"] as const) {
      expect(accept(await holderClaimIxs(program, claimed(), keys.holder.publicKey, a), keys.holder).ok).toBe(true);
    }
  });

  it("each step anyone may send, co-signed by a throwaway caller key", async () => {
    const caller = Keypair.generate();
    const dormant = v({ shop: shopAcc({ status: ShopStatus.Dormant }) });
    const cases: [PermissionlessAction, ReturnType<typeof v>][] = [
      ["settleUnanswered", claimed()],
      ["settleStaleDispute", claimed()],
      ["closeStale", claimed()],
      ["declareDormant", v()],
      ["claimOrphan", dormant],
      ["releaseExpired", v()],
    ];
    for (const [action, view_] of cases) {
      const r = accept(await settleIxs(program, view_, action, relayer.publicKey, caller.publicKey), caller);
      expect(r.ok ? r.signers : r, action).toEqual([caller.publicKey.toBase58()]);
    }
  });

  it("send paid money to another address, creating its account", () => {
    const r = accept(sendIxs(v(), relayer.publicKey, keys.holder.publicKey, Keypair.generate().publicKey, 1_000_000n), keys.holder);
    expect(r.ok && r.accountCreates).toBe(1);
  });

  it("a claim fingerprint ignores surrounding space and Unicode form", () => {
    expect(evidenceHash("leak", " café ")).toEqual(evidenceHash("leak", "café"));
    expect(evidenceHash("leak", "a")).not.toEqual(evidenceHash("noise", "a"));
  });
});
