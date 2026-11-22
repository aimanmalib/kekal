import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import ms from "../../../locales/ms.json";
import { pickLang, translator } from "../src/lib/i18n";

describe("locales", () => {
  it("en and ms have the same keys", () => {
    expect(Object.keys(ms).sort()).toEqual(Object.keys(en).sort());
  });
  it("no empty strings", () => {
    for (const dict of [en, ms]) for (const [k, v] of Object.entries(dict)) expect(v.trim(), k).not.toBe("");
  });
});

describe("pickLang", () => {
  it("saved cookie wins", () => expect(pickLang("ms", "en-US,en;q=0.9")).toBe("ms"));
  it("ignores an unknown saved value", () => expect(pickLang("fr", "ms-MY")).toBe("ms"));
  it("follows Accept-Language order and q", () => {
    expect(pickLang(undefined, "fr;q=1, ms;q=0.8, en;q=0.5")).toBe("ms");
    expect(pickLang(undefined, "en;q=0.4, ms;q=0.9")).toBe("ms");
  });
  it("skips q=0", () => expect(pickLang(undefined, "ms;q=0, de")).toBe("en"));
  it("falls back when nothing matches", () => {
    expect(pickLang(undefined, "de-DE")).toBe("en");
    expect(pickLang(undefined, null)).toBe("en");
  });
  it("translator returns the language text", () => {
    expect(translator("ms")("lang.label")).toBe(ms["lang.label"]);
    expect(translator("en")("lang.label")).toBe(en["lang.label"]);
  });
});
