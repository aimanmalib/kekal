import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import app from "../../../config/app.json";
import { LANG_HEADER, queryLang, withoutLangParam } from "../src/lib/lang-query";
import { proxy } from "../src/proxy";

const param = app.web.locales.queryParam;
const cookie = app.web.locales.cookie;
const [first, second] = app.web.locales.supported as [string, string];

describe("queryLang", () => {
  it("reads a supported language, any case", () => {
    expect(queryLang(new URLSearchParams(`${param}=${second}`))).toBe(second);
    expect(queryLang(new URLSearchParams(`${param}=${second.toUpperCase()}`))).toBe(second);
  });
  it("ignores missing or unknown values", () => {
    expect(queryLang(new URLSearchParams(""))).toBeNull();
    expect(queryLang(new URLSearchParams(`${param}=xx`))).toBeNull();
  });
});

describe("withoutLangParam", () => {
  it("drops only the language parameter", () => {
    expect(withoutLangParam("/demo", `?${param}=${second}`)).toBe("/demo");
    expect(withoutLangParam("/w/abc", `?a=1&${param}=${first}`)).toBe("/w/abc?a=1");
    expect(withoutLangParam("/", "")).toBe("/");
  });
});

describe("proxy", () => {
  it("passes the query language to the page and saves it in the cookie", () => {
    const res = proxy(new NextRequest(`https://example.test/?${param}=${second}`));
    expect(res.headers.get(`x-middleware-request-${LANG_HEADER}`)).toBe(second);
    expect(res.cookies.get(cookie)?.value).toBe(second);
  });
  it("strips a language header sent by the client when the query has none", () => {
    const req = new NextRequest("https://example.test/demo", { headers: { [LANG_HEADER]: second } });
    const res = proxy(req);
    expect(res.headers.get(`x-middleware-request-${LANG_HEADER}`)).toBeNull();
    expect(res.headers.get("x-middleware-override-headers") ?? "").not.toContain(LANG_HEADER);
    expect(res.cookies.get(cookie)).toBeUndefined();
  });
});
