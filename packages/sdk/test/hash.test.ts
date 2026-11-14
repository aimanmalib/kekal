import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { canonicalJson, fromHex, hashJson, productHash, toHex } from "../src/hash";

// Expected strings and digests were computed independently (Python hashlib over the literal string).
const VECTORS = [
  {
    name: "terms with unicode",
    value: { unicode: "Café ☕ 😀", termDays: 365, reserve: "5000000", model: "X-200", currency: "kUSD" },
    json: '{"currency":"kUSD","model":"X-200","reserve":"5000000","termDays":365,"unicode":"Café ☕ 😀"}',
    sha256: "114d783c46d731609de741419c1d923feaa9006f5629941aad43ff6f9dc1c43f",
  },
  {
    name: "nesting and escapes",
    value: { z: -0.5, a: [1, true, null, { b: '\u0000\n"x"' }] },
    json: '{"a":[1,true,null,{"b":"\\u0000\\n\\"x\\""}],"z":-0.5}',
    sha256: "bb0fa672531fc799c39bc2331d2b4cf6704dddceb0bd4b0dc8ae31fec4a9e657",
  },
  {
    name: "key order by UTF-16 code unit",
    value: { "😀": 6, é: 5, b: 4, aa: 3, a: 2, A: 1, "": 0 },
    json: '{"":0,"A":1,"a":2,"aa":3,"b":4,"é":5,"😀":6}',
    sha256: "e9772f79b5e006bc452ad3a2af4c3da1ba519606d892b04c917d80ba5a30de46",
  },
  { name: "empty object", value: {}, json: "{}", sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a" },
];

describe("canonical JSON hash", () => {
  for (const v of VECTORS) {
    it(v.name, () => {
      expect(canonicalJson(v.value)).toBe(v.json);
      expect(toHex(hashJson(v.value))).toBe(v.sha256);
    });
  }

  it("is independent of key insertion order", () => {
    expect(toHex(hashJson({ a: 1, b: { c: 2, d: 3 } }))).toBe(toHex(hashJson({ b: { d: 3, c: 2 }, a: 1 })));
  });

  it.each([
    ["undefined", { a: undefined }],
    ["NaN", { a: Number.NaN }],
    ["Infinity", [Infinity]],
    ["bigint", { a: 1n }],
    ["Date", { a: new Date(0) }],
    ["lone surrogate", { a: "\ud800" }],
  ])("rejects %s", (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });
});

describe("productHash", () => {
  const shop = new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

  it("matches the independent vector", () => {
    expect(toHex(productHash(shop, "SN-001", "Kettle K2"))).toBe(
      "f25741ef18625de7be74f7908a456817544217c43bb5c038d7b9d760c51f07b6",
    );
  });

  it("normalises whitespace and Unicode form", () => {
    expect(productHash(shop, "  SN-001 ", "Kettle K2")).toEqual(productHash(shop, "SN-001", "Kettle K2"));
    expect(productHash(shop, "Café", "m")).toEqual(productHash(shop, "Café", "m"));
  });

  it("does not collide when text moves between serial and model", () => {
    expect(productHash(shop, "AB", "C")).not.toEqual(productHash(shop, "A", "BC"));
  });
});

describe("hex", () => {
  it("round-trips and rejects junk", () => {
    expect(toHex(fromHex("00ff10"))).toBe("00ff10");
    expect(() => fromHex("0g")).toThrow();
  });
});
