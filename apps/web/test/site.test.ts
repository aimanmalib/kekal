import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import app from "../../../config/app.json";
import { translator } from "../src/lib/i18n";
import { pageMetadata, robotsFile, siteUrl, siteViewport } from "../src/lib/site";

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
  // The bots the docs promise previews for. A fixed list, so dropping one from config turns this red.
  const promised = ["WhatsApp", "TelegramBot", "Twitterbot", "LinkedInBot", "facebookexternalhit"];
  it("names the promised preview bots in their own group, ahead of the default group", () => {
    const agents = rules[0]?.userAgent;
    expect(Array.isArray(agents)).toBe(true);
    expect(agents).toEqual(expect.arrayContaining(promised));
    expect(agents).not.toContain("*");
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
  it("lists the card with its size and the locale alt text, on Open Graph and Twitter", () => {
    for (const lang of ["ms", "en"] as const) {
      const t = translator(lang);
      const m = pageMetadata(t, lang, {});
      const card = { url: "/opengraph-image.png", width: og.width, height: og.height, alt: t("meta.ogAlt") };
      expect(m.openGraph?.images).toEqual([card]);
      expect((m.twitter as { images?: unknown })?.images).toEqual([card]);
    }
    expect(translator("ms")("meta.ogAlt")).not.toBe(translator("en")("meta.ogAlt"));
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
  it("has alt text of a readable length in every locale", () => {
    for (const lang of ["ms", "en"] as const) {
      const alt = translator(lang)("meta.ogAlt");
      expect(alt.length).toBeGreaterThan(20);
      expect(alt.length).toBeLessThanOrEqual(og.altMaxChars);
    }
  });
  it("has no .alt.txt beside it, so the locale alt text is the only one", () => {
    expect(() => asset("opengraph-image.alt.txt")).toThrow();
  });
});

describe("icons and theme colour", () => {
  it("theme colour is the --paper token from globals.css", () => {
    const css = asset("globals.css").toString("utf8");
    const paper = /--paper:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(css)?.[1];
    expect(paper).toBeDefined();
    expect(app.web.site.themeColor.toLowerCase()).toBe(paper?.toLowerCase());
    expect(siteViewport.themeColor).toBe(app.web.site.themeColor);
  });
  it("icon.svg is a square SVG that draws without fonts", () => {
    const svg = asset("icon.svg").toString("utf8");
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 (\d+) \1"/);
    expect(svg).not.toMatch(/<text|font-family/);
  });
  it("apple-icon.png is an opaque PNG of the configured size", () => {
    const png = asset("apple-icon.png");
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(app.web.site.appleIcon.size);
    expect(png.readUInt32BE(20)).toBe(app.web.site.appleIcon.size);
    expect([0, 2]).toContain(png[25]); // greyscale or RGB: no alpha channel
  });
});

describe("hackathon form images in docs/media", () => {
  const { gallery: g, banner: b } = app.web.site;
  const media = (name: string) => readFileSync(new URL(`../../../docs/media/${name}`, import.meta.url));
  const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
  it("gallery images are PNGs of the configured size, within the byte limit", () => {
    for (const name of ["gallery-paid.png", "gallery-card.png", "gallery-examples.png"]) {
      const png = media(name);
      expect(png.subarray(1, 4).toString("latin1"), name).toBe("PNG");
      expect(size(png), name).toEqual([g.width, g.height]);
      expect(png.length, name).toBeLessThanOrEqual(g.maxBytes);
    }
  });
  it("the banner is drawn at the banner size, 3:1 or 4:1 as the form asks, within the byte limit", () => {
    const png = media("banner.png");
    expect(size(png)).toEqual([b.width * b.scale, b.height * b.scale]);
    expect([3, 4]).toContain(b.width / b.height);
    expect(png.length).toBeLessThanOrEqual(b.maxBytes);
  });
});
