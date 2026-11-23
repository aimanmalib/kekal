import { ShopStatus, readOnlyProgram, type ShopAccount } from "@kekal/sdk";
import { Connection, Keypair, type TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { runPass, type ChainReader, type PassDeps } from "../src/pass";
import type { Keyed, LiveWarranty } from "../src/plan";
import { shop, warranty } from "./fixtures";

const program = readOnlyProgram(new Connection("http://127.0.0.1:1"));
const coder = program.coder.instruction as unknown as { decode(d: Buffer): { name: string } | null };
const ixName = (i: TransactionInstruction) => coder.decode(i.data)?.name ?? "?";

interface World {
  shops: Keyed<ShopAccount>[];
  warranties: LiveWarranty[];
  clock: number;
}

function harness(world: World, fail: (name: string) => Error | null = () => null) {
  const sent: { name: string; payer: string }[] = [];
  const reader: ChainReader = {
    shops: async () => world.shops,
    liveWarranties: async () => world.warranties,
    disputeTimeoutSecs: async () => 300,
    clock: async () => world.clock,
  };
  const feePayer = Keypair.generate();
  const demoOwner = Keypair.generate();
  const deps: PassDeps = {
    program,
    reader,
    send: async (payer, ixs) => {
      const name = ixName(ixs[0]!);
      sent.push({ name, payer: payer.publicKey.toBase58() });
      const err = fail(name);
      if (err) throw err;
      // declare_dormant changes what the next read returns
      if (name === "declareDormant") {
        world.shops = world.shops.map((s) => (s.account.owner.equals(demoOwner.publicKey) ? s : { ...s, account: { ...s.account, status: ShopStatus.Dormant, dormantAt: world.clock } }));
      }
      return `sig-${sent.length}`;
    },
    feePayer,
    heartbeatOwners: [demoOwner],
    lastHeartbeat: new Map(),
    heartbeatEverySecs: 30,
    maxActions: 10,
    log: () => undefined,
  };
  return { deps, sent, feePayer, demoOwner };
}

describe("runPass", () => {
  it("heartbeats the demo shop, declares the silent shop dormant, then pays its holder and the unanswered claim", async () => {
    const world: World = { shops: [], warranties: [], clock: 1_500 };
    const h = harness(world);
    const demo = shop(h.demoOwner.publicKey, { lastSeen: 1_000 }); // lapsed too, but its owner heartbeats first
    const silent = shop(Keypair.generate().publicKey, { lastSeen: 1_000 });
    world.shops = [demo, silent];
    world.warranties = [warranty(silent.key), warranty(demo.key, {}, { filedAt: 1_300 })];
    const r = await runPass(h.deps);
    expect(h.sent.map((s) => s.name)).toEqual(["heartbeat", "declareDormant", "settleUnanswered", "claimOrphan"]); // warranty steps oldest due first
    expect(h.sent[0]!.payer).toBe(h.demoOwner.publicKey.toBase58());
    expect(h.sent.slice(1).every((s) => s.payer === h.feePayer.publicKey.toBase58())).toBe(true);
    expect(r.failed).toBe(0);
  });

  it("does not heartbeat again within heartbeatEverySecs, and skips a dormant demo shop", async () => {
    const world: World = { shops: [], warranties: [], clock: 1_000 };
    const h = harness(world);
    world.shops = [shop(h.demoOwner.publicKey, { lastSeen: 990 })];
    await runPass(h.deps);
    world.clock = 1_020;
    await runPass(h.deps);
    world.clock = 1_030;
    await runPass(h.deps);
    expect(h.sent.map((s) => s.name)).toEqual(["heartbeat", "heartbeat"]);
    world.shops = [shop(h.demoOwner.publicKey, { status: ShopStatus.Dormant, dormantAt: 1_000 })];
    world.clock = 2_000;
    await runPass(h.deps);
    expect(h.sent).toHaveLength(2);
  });

  it("a lost race is skipped, a real failure is counted, and the pass goes on", async () => {
    const world: World = { shops: [], warranties: [], clock: 200_000 };
    const h = harness(world, (name) =>
      name === "releaseExpired" ? new Error("AnchorError ... Error Code: WarrantyNotActive. Error Number: 6017") : name === "settleUnanswered" ? new Error("blockhash not found") : null,
    );
    const s = shop(Keypair.generate().publicKey, { lastSeen: 199_990, heartbeatSecs: 1_000 });
    world.shops = [s];
    world.warranties = [warranty(s.key, { expiresAt: 100 }), warranty(s.key, {}, { filedAt: 100 })];
    const r = await runPass(h.deps);
    expect(r.outcomes.map((o) => [o.step, o.stale ?? false, Boolean(o.error)])).toEqual([
      ["releaseExpired", true, true],
      ["settleUnanswered", false, true],
    ]);
    expect(r.failed).toBe(1);
  });

  it("nothing due = nothing sent", async () => {
    const world: World = { shops: [], warranties: [], clock: 1_010 };
    const h = harness(world);
    h.deps.heartbeatOwners = [];
    const s = shop(Keypair.generate().publicKey);
    world.shops = [s];
    world.warranties = [warranty(s.key)];
    expect((await runPass(h.deps)).outcomes).toEqual([]);
    expect(h.sent).toEqual([]);
  });
});
