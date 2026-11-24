// Draws apps/web/src/app/apple-icon.png from the favicon (apps/web/src/app/icon.svg).
// Run from the repo root after `pnpm install`: node brand/render-icons.mjs   (needs Playwright with Chromium)
// Size from config/app.json web.site.appleIcon. The rounded corners are dropped and the square is filled edge to
// edge with the icon background, because iOS applies its own mask and shows transparent corners as black.
/* global console */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// CommonJS require so a global Playwright install is found through NODE_PATH.
const { chromium } = createRequire(import.meta.url)("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = JSON.parse(readFileSync(resolve(root, "config/app.json"), "utf8"));
const { size } = app.web.site.appleIcon;
const src = resolve(root, "apps/web/src/app/icon.svg");
const out = resolve(root, "apps/web/src/app/apple-icon.png");

const svg = readFileSync(src, "utf8")
  .replace(/\s+rx="[^"]*"/, "") // first rect = background: square corners
  .replace("<svg ", `<svg width="${size}" height="${size}" `);
const bg = /<rect[^>]*fill="(#[0-9A-Fa-f]{6})"/.exec(svg)?.[1];
if (!bg) throw new Error("icon.svg: no background rect fill found");

const html = `<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:${bg}}svg{display:block}</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const png = await page.screenshot({ type: "png", omitBackground: false });
  writeFileSync(out, png);
  console.log(`apple-icon.png ${size}x${size}, ${png.length} bytes`);
} finally {
  await browser.close();
}
