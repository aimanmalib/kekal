// Draws apps/web/src/app/apple-icon.png and apps/web/src/app/favicon.ico from the favicon (apps/web/src/app/icon.svg).
// Run from the repo root after `pnpm install`: node brand/render-icons.mjs   (needs Playwright with Chromium)
// Sizes from config/app.json web.site.appleIcon and web.site.faviconIco (PNG entries inside one .ico, for browsers
// and crawlers that ask for /favicon.ico directly). The rounded corners are dropped and the square is filled edge to
// edge with the icon background, because iOS applies its own mask and shows transparent corners as black.
/* global console, Buffer */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// CommonJS require so a global Playwright install is found through NODE_PATH.
const { chromium } = createRequire(import.meta.url)("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = JSON.parse(readFileSync(resolve(root, "config/app.json"), "utf8"));
const { size } = app.web.site.appleIcon;
const icoSizes = app.web.site.faviconIco.sizes;
const src = resolve(root, "apps/web/src/app/icon.svg");
const out = resolve(root, "apps/web/src/app/apple-icon.png");
const icoOut = resolve(root, "apps/web/src/app/favicon.ico");
const icon = readFileSync(src, "utf8");

const svg = icon
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

  const pngs = [];
  for (const s of icoSizes) {
    const p = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
    const sized = icon.replace("<svg ", `<svg width="${s}" height="${s}" `);
    await p.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${sized}</body></html>`);
    pngs.push({ s, png: await p.screenshot({ type: "png", omitBackground: true }) });
    await p.close();
  }
  const ico = icoFile(pngs);
  writeFileSync(icoOut, ico);
  console.log(`favicon.ico ${icoSizes.join("/")}, ${ico.length} bytes`);
} finally {
  await browser.close();
}

/** ICO container with PNG payloads: 6-byte header, one 16-byte directory entry per image, then the images. */
function icoFile(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ s, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s >= 256 ? 0 : s, e);
    header.writeUInt8(s >= 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((x) => x.png)]);
}
