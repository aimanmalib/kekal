import { ix, readOnlyProgram } from "@kekal/sdk";
import { Connection, Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { issueInstructions } from "../lib/setup";

const p = readOnlyProgram(new Connection("http://127.0.0.1:1"));
const owner = Keypair.generate().publicKey;
const params = {
  holder: Keypair.generate().publicKey,
  reserve: 25n,
  termSecs: 300,
  termsHash: new Uint8Array(32),
  productHash: new Uint8Array(32),
};

describe("issueInstructions", () => {
  it("issues alone by default", async () => {
    const ixs = await issueInstructions(p, owner, 0n, params, false);
    const issue = await ix.issueWarranty(p, { owner, warrantyId: 0n, params });
    expect(ixs.map((i) => i.data.toString("hex"))).toEqual([issue.data.toString("hex")]);
  });

  // Regression: path C's shop has a heartbeat window of seconds and lapsed before its warranty was issued on a busy host
  // (HeartbeatLapsed, 6013). The heartbeat must sit in the same transaction, right before the issue.
  it("puts the heartbeat first, in the same transaction, when asked", async () => {
    const ixs = await issueInstructions(p, owner, 0n, params, true);
    const beat = await ix.heartbeat(p, { owner });
    const issue = await ix.issueWarranty(p, { owner, warrantyId: 0n, params });
    expect(ixs.map((i) => i.data.toString("hex"))).toEqual([beat.data.toString("hex"), issue.data.toString("hex")]);
  });
});
