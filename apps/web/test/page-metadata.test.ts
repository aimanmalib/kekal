import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("../src/app", import.meta.url));

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return pages(p);
    return /^page\.(tsx|ts|jsx|js)$/.test(e.name) ? [p] : [];
  });
}

const exportsMetadata = (src: string) =>
  /export\s+(async\s+)?function\s+generateMetadata\b/.test(src) || /export\s+const\s+(metadata|generateMetadata)\b/.test(src);

describe("page metadata guard", () => {
  it("finds the home page", () => {
    expect(pages(appDir).map((p) => relative(appDir, p))).toContain("page.tsx");
  });

  it("every page exports metadata while the opengraph-image file exists", () => {
    expect(existsSync(join(appDir, "opengraph-image.png"))).toBe(true);
    const missing = pages(appDir)
      .filter((p) => !exportsMetadata(readFileSync(p, "utf8")))
      .map((p) => relative(appDir, p));
    expect(
      missing,
      "Next.js replaces a page's Open Graph images with app/opengraph-image.png (no alt text) unless the page's own " +
        "metadata lists images. Export generateMetadata from these pages, returning localeMetadata().",
    ).toEqual([]);
  });

  it("pages reuse the shared function instead of re-exporting the layout", () => {
    for (const p of pages(appDir)) {
      const src = readFileSync(p, "utf8");
      expect(src, relative(appDir, p)).not.toMatch(/from\s+["']\.\/layout["']/);
      expect(src, relative(appDir, p)).toMatch(/localeMetadata\(\)/);
    }
  });
});
