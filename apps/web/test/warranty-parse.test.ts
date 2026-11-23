import { KEKAL_IDL, base58, hashJson, readOnlyProgram, toHex } from "@kekal/sdk";
import { Connection, Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { addressFromInput } from "../src/lib/warranty/check";
import { cardLink, seedFromFragment } from "../src/lib/warranty/client";
import { clock, formatUnits, parseUnits } from "../src/lib/warranty/format";
import { parseAddress, termsMatch, timelineEntry } from "../src/lib/warranty/read";
import { readTerms } from "../src/lib/warranty/terms";

const ADDR = Keypair.generate().publicKey.toBase58();

describe("amounts and clock", () => {
  it("formats base units to two decimals and parses typed amounts back", () => {
    expect(formatUnits("25000000", 6)).toBe("25.00");
    expect(formatUnits(1_234_567n, 6)).toBe("1.23");
    expect(parseUnits("12.5", 6)).toBe(12_500_000n);
    expect(parseUnits("0.0000001", 6)).toBeNull();
    expect(parseUnits("1,5", 6)).toBeNull();
    expect(clock(61)).toBe("1:01");
    expect(clock(3_661)).toBe("1:01:01");
    expect(clock(-5)).toBe("0:00");
  });
});

describe("card key in the URL fragment", () => {
  it("reads a 32-byte seed and ignores anything else", () => {
    const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const link = cardLink("https://kekal.example", ADDR, "k", seed);
    expect(link).toBe(`https://kekal.example/w/${ADDR}#k=${base58.encode(seed)}`);
    expect(seedFromFragment(new URL(link).hash, "k")).toEqual(seed);
    expect(seedFromFragment("#k=abc", "k")).toBeNull();
    expect(seedFromFragment("#x=" + base58.encode(seed), "k")).toBeNull();
    expect(seedFromFragment("", "k")).toBeNull();
  });
});

describe("/semak input", () => {
  it("accepts an address or a card link and drops the key fragment", () => {
    expect(addressFromInput(` ${ADDR} `)).toBe(ADDR);
    expect(addressFromInput(`https://kekal.example/w/${ADDR}#k=secret`)).toBe(ADDR);
    expect(addressFromInput(`https://kekal.example/w/${ADDR}/`)).toBe(ADDR);
    expect(addressFromInput("hello")).toBeNull();
    expect(addressFromInput(`https://kekal.example/x/${ADDR}`)).toBeNull();
  });

  it("parseAddress refuses non-base58 and wrong lengths", () => {
    expect(parseAddress(ADDR)?.toBase58()).toBe(ADDR);
    expect(parseAddress("0OIl")).toBeNull();
    expect(parseAddress("../etc/passwd")).toBeNull();
  });
});

describe("terms text", () => {
  it("matches the on-chain hash byte for byte or as canonical JSON, and says no otherwise", () => {
    const terms = { v: 1, product: { en: "Fan", ms: "Kipas" }, promise: "Fixed free" };
    const hash = hashJson(terms);
    expect(termsMatch(JSON.stringify(terms, null, 2), hash)).toBe(true);
    expect(termsMatch(JSON.stringify({ ...terms, promise: "Fixed for a fee" }), hash)).toBe(false);
    expect(termsMatch("not json", hash)).toBe(false);
    expect(toHex(hash)).toHaveLength(64);
  });

  it("reads per-language fields with a fallback, and plain strings", () => {
    const json = JSON.stringify({ product: { en: "Fan", ms: "Kipas" }, promise: "Fixed free" });
    expect(readTerms(json, "ms", "en")).toEqual({ product: "Kipas", promise: "Fixed free" });
    expect(readTerms(JSON.stringify({ product: { en: "Fan" } }), "ms", "en").product).toBe("Fan");
    expect(readTerms("[1", "en", "en")).toEqual({ product: null, promise: null });
    expect(readTerms(null, "en", "en")).toEqual({ product: null, promise: null });
  });
});

describe("timeline entries from transaction logs", () => {
  const program = readOnlyProgram(new Connection("http://127.0.0.1:9"));
  const id = program.programId.toBase58();
  const disc = (name: string) => Uint8Array.from((KEKAL_IDL.events ?? []).find((e) => e.name === name)!.discriminator);
  const u64 = (n: bigint) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return b;
  };
  const log = (...parts: Uint8Array[]) => `Program data: ${Buffer.concat(parts).toString("base64")}`;
  const k = () => Keypair.generate().publicKey;

  it("reads a payout and its reason, and the new holder of a transfer", () => {
    const newHolder = k();
    const logs = [
      `Program ${id} invoke [1]`,
      log(disc("ReservePaid"), k().toBytes(), k().toBytes(), k().toBytes(), u64(25_000_000n), Uint8Array.of(9)),
      log(disc("HolderTransferred"), k().toBytes(), k().toBytes(), newHolder.toBytes()),
      `Program ${id} success`,
    ];
    const e = timelineEntry(program, "s", 5, false, logs);
    expect(e.events).toEqual(["ReservePaid", "HolderTransferred"]);
    expect(e.paid).toEqual({ amount: "25000000", claimStatus: 9 });
    expect(e.newHolder).toBe(newHolder.toBase58());
  });

  it("a failed transaction carries no events", () => {
    expect(timelineEntry(program, "s", 5, true, [`Program ${id} invoke [1]`]).events).toEqual([]);
  });
});
