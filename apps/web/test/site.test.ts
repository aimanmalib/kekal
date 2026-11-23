import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import app from "../../../config/app.json";
import { translator } from "../src/lib/i18n";
import { pageMetadata, robotsFile, siteUrl } from "../src/lib/site";

const og = app.web.site.ogImage;
const asset = (name: string) => readFileSync(new URL(`../src/app/${name}`, import.meta.url));

describe("siteUrl", () => {
  it("uses the config url, or KEKAL_SITE_URL without a trailing slash", () => {
    expect(siteUrl({}).href).toBe(new URL(app.web.site.url).href);
    expect(siteUrl({ KEKAL_SITE_URL: "http://localhost:3310/" }).origin).toBe("http://localhost:3310");
  });
  it("rejects a non-http address", () => {
    expect(() => siteUrl({ KEKAL_SITE_URL: "javascript:alert(1)" })).toThrow();
  });
});

describe("robots", () => {
  const r = robotsFile({});
  const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
  it("names every preview bot in its own group, ahead of the default group", () => {
    expect(rules[0]?.userAgent).toEqual(app.web.site.previewBots);
    expect(rules.at(-1)?.userAgent).toBe("*");
  });
  it("lets every group read pages but not the API", () => {
    for (const rule of rules) {
      expect(rule.allow).toBe("/");
      expect(rule.disallow).toEqual(app.web.site.disallow);
    }
    expect(app.web.site.disallow).toContain("/api/");
  });
});

describe("link preview metadata", () => {
  it("sets an absolute base, Open Graph and a large Twitter card from the locale text", () => {
    const t = translator("ms");
    const m = pageMetadata(t, "ms", {});
    expect(String(m.metadataBase)).toBe(new URL(app.web.site.url).href);
    expect(m.title).toBe(t("meta.title"));
    expect(m.openGraph).toMatchObject({ title: t("meta.title"), description: t("meta.description"), locale: "ms_MY" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
  });
});

describe("opengraph-image.png", () => {
  const png = asset("opengraph-image.png");
  it("is a PNG of the configured size", () => {
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(og.width);
    expect(png.readUInt32BE(20)).toBe(og.height);
  });
  it("stays under the byte limit", () => {
    expect(png.length).toBeLessThanOrEqual(og.maxBytes);
  });
  it("has alt text of a readable length", () => {
    const alt = asset("opengraph-image.alt.txt").toString("utf8").trim();
    expect(alt.length).toBeGreaterThan(20);
    expect(alt.length).toBeLessThanOrEqual(og.altMaxChars);
  });
});
