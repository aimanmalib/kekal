// Draws the link-preview card (apps/web/src/app/opengraph-image.png) from the real stylesheet, fonts and English text.
// Run from the repo root after `pnpm install`: node brand/render-og.mjs   (needs Playwright with Chromium)
// Colours, fonts and the card markup come from apps/web (globals.css tokens, WarrantyCard classes); copy from
// locales/en.json; size and byte limit from config/app.json web.site.ogImage.
/* global console, document, innerWidth, innerHeight */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// CommonJS require so a global Playwright install is found through NODE_PATH.
const { chromium } = createRequire(import.meta.url)("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "apps/web");
const app = JSON.parse(readFileSync(resolve(root, "config/app.json"), "utf8"));
const en = JSON.parse(readFileSync(resolve(root, "locales/en.json"), "utf8"));
const { width, height, maxBytes } = app.web.site.ogImage;
const out = resolve(web, "src/app/opengraph-image.png");

const cluster = app.clusters[app.defaultCluster];
const reserve = (Number(BigInt(cluster.lifecycle.reserve)) / 10 ** cluster.tokenDecimals).toFixed(2);

// Same curve as apps/web/src/components/Guilloche.tsx.
function wavePath(w, h, waves, phase, amp) {
  const steps = waves * 24;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * waves * 2 * Math.PI;
    const y = h / 2 + amp * Math.sin(t + phase) * Math.cos(t / 3 - phase / 2);
    d += `${i === 0 ? "M" : "L"}${((i / steps) * w).toFixed(1)} ${y.toFixed(2)}`;
  }
  return d;
}
const band = (w, h, lines, waves) =>
  `<svg class="guilloche" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${Array.from({ length: lines }, (_, i) =>
    `<path d="${wavePath(w, h, waves, (i / lines) * Math.PI * 2, h * 0.42)}"/>`).join("")}</svg>`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const css = (p) => `<link rel="stylesheet" href="${pathToFileURL(resolve(web, p)).href}">`;
const field = (k, v, cls = "") => `<div><dt>${esc(en[k])}</dt><dd class="${cls}">${v}</dd></div>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
${css("node_modules/@fontsource-variable/newsreader/index.css")}
${css("node_modules/@fontsource-variable/public-sans/index.css")}
${css("node_modules/@fontsource/ibm-plex-mono/400.css")}
${css("node_modules/@fontsource/ibm-plex-mono/500.css")}
${css("src/app/globals.css")}
<style>
  html, body { width: ${width}px; height: ${height}px; margin: 0; overflow: hidden; background: var(--paper); }
  .og { box-sizing: border-box; height: 100%; padding: 56px 64px; display: grid;
        grid-template-columns: 1fr 400px; gap: 56px; align-items: center; border-top: 14px solid var(--ink); }
  .og .wordmark { font-size: 34px; color: var(--ink); }
  .og h1 { font-family: var(--font-display); font-size: 64px; line-height: 1.04; margin: 22px 0 24px;
           color: var(--ink); font-weight: 500; letter-spacing: -0.01em; }
  .og .rules { margin: 0; font-size: 23px; color: var(--ink); }
  .og .rules li { padding: 11px 0; }
  .og .card { max-width: none; }
  .og .guilloche { height: 52px; }
  .og .card-title { font-size: 30px; }
  .og .card-fields { gap: 12px; font-size: 19px; }
  .og .card-fields dt { font-size: 16px; }
  .og .num { font-size: 24px; }
</style></head><body>
<div class="og">
  <section>
    <span class="wordmark">${esc(en["app.name"])}</span>
    <h1>${esc(en["home.title"])}</h1>
    <ul class="rules">${["home.rule.silent", "home.rule.gone", "home.rule.expired"].map((k) => `<li>${esc(en[k])}</li>`).join("")}</ul>
  </section>
  <figure class="card">
    ${band(400, 52, 9, 6)}
    <div class="card-body">
      <p class="card-title">${esc(en["card.title"])}</p>
      <dl class="card-fields">
        ${field("card.product", esc(en["card.sample.product"]))}
        ${field("card.reserve", `${reserve} <span class="unit">${esc(app.web.currency)}</span>`, "num")}
        ${field("card.status", esc(en["status.claim.paidOrphan"]))}
      </dl>
      <span class="stamp">${esc(en["stamp.paid"])}</span>
    </div>
  </figure>
</div></body></html>`;

// Loaded from a file so the file:// stylesheets and fonts are allowed.
const tmp = mkdtempSync(resolve(tmpdir(), "kekal-og-"));
const htmlFile = resolve(tmp, "og.html");
writeFileSync(htmlFile, html);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
  if (over) throw new Error("card content overflows the canvas");
  writeFileSync(out, await page.screenshot({ type: "png" }));
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
const bytes = statSync(out).size;
if (bytes > maxBytes) throw new Error(`${out}: ${bytes} bytes > ${maxBytes}`);
console.log(`wrote ${width}x${height} ${bytes} bytes`);
