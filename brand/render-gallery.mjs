// Draws the gallery images for the hackathon form: one real phone screen of the live site beside one large sentence.
// Take the screenshots first (WebKit iPhone 13, English, from the live devnet site), inside e2e/:
//   E2E_BASE_URL=<site> E2E_SHOTS=<shots> E2E_GALLERY=1 npx playwright test tests/gallery-shots.spec.ts --project=webkit-iphone13
//   E2E_BASE_URL=<site> E2E_SHOTS=<shots> npx playwright test tests/demo.spec.ts --project=webkit-iphone13 -g "path B"
// then, from the repo root after `pnpm install`: node brand/render-gallery.mjs <shots> <out>   (needs Playwright with Chromium)
// Writes <out>/gallery-{paid,card,examples}.png at web.site.gallery width x height, each at most gallery.maxBytes.
// Colours and fonts come from apps/web/src/app/globals.css; the sentences are gallery.* in locales/en.json.
// Each phone screen is one web.site.gallery.phoneScreen crop of a full-page screenshot, starting at the offset below.
// Offsets depend on the page layout: re-check them by eye after a layout change.
/* global console, document, innerWidth, innerHeight, process, Image */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const { width, height, phoneScreen: SCREEN, maxBytes } = app.web.site.gallery;

const SCALE = 3; // iPhone 13 device pixel ratio of the screenshots

// image: [screenshot, top of the crop in CSS px, sentence key]
const IMAGES = {
  paid: ["e2e-webkit-iphone13-demo-silent-paid.png", 672, "gallery.paid"], // demo path B: steps, payout, stamped card
  card: ["e2e-webkit-iphone13-gallery-home.png", 0, "gallery.card"], // home page: title and the sample card
  examples: ["e2e-webkit-iphone13-gallery-contoh.png", 0, "gallery.examples"], // finished paths, each step a public record
};

const [shots, outDir] = process.argv.slice(2).map((p) => resolve(p));
if (!shots || !outDir) {
  console.error("usage: node brand/render-gallery.mjs <screenshots dir> <out dir>");
  process.exit(2);
}
for (const [file] of Object.values(IMAGES)) {
  if (!existsSync(resolve(shots, file))) throw new Error(`missing screenshot ${file}; run the e2e commands above first`);
}
mkdirSync(outDir, { recursive: true });

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const css = (p) => `<link rel="stylesheet" href="${pathToFileURL(resolve(web, p)).href}">`;
// The phone screen fills the frame height; its width follows the screenshot's aspect ratio.
const BORDER = 14;
const PAD = 28;
const BEZEL = 10;
const screenH = height - BORDER - 2 * PAD - 2 * BEZEL;
const screenW = Math.round((screenH * SCREEN.width) / SCREEN.height);
const page = (sentence) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
${css("node_modules/@fontsource-variable/newsreader/index.css")}
${css("node_modules/@fontsource-variable/public-sans/index.css")}
${css("src/app/globals.css")}
<style>
  html, body { width: ${width}px; height: ${height}px; margin: 0; overflow: hidden; background: var(--paper); }
  .frame { box-sizing: border-box; height: 100%; border-top: ${BORDER}px solid var(--ink); display: grid;
           grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 72px; padding: ${PAD}px 72px ${PAD}px 88px; }
  .text { display: flex; flex-direction: column; gap: 40px; }
  .wordmark { font-size: 32px; color: var(--ink); }
  .sentence { font-family: var(--font-display); font-weight: 500; font-size: 66px; line-height: 1.08;
              letter-spacing: -0.01em; color: var(--ink); margin: 0; text-wrap: balance; }
  .screen { width: ${screenW}px; height: ${screenH}px; border: ${BEZEL}px solid var(--ink); border-radius: 40px;
            overflow: hidden; background: var(--paper); }
  .screen canvas { display: block; width: 100%; height: 100%; }
</style></head><body><div class="frame">
  <div class="text"><span class="wordmark">${esc(en["app.name"])}</span><p class="sentence">${esc(sentence)}</p></div>
  <div class="screen"><canvas></canvas></div>
</div></body></html>`;

const tmp = mkdtempSync(resolve(tmpdir(), "kekal-gallery-"));
const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  for (const [name, [shot, top, key]] of Object.entries(IMAGES)) {
    const file = resolve(tmp, `${name}.html`);
    writeFileSync(file, page(en[key]));
    await tab.goto(pathToFileURL(file).href, { waitUntil: "load" });
    // Crop on a canvas so the page needs no file paths beyond the stylesheets.
    const data = `data:image/png;base64,${readFileSync(resolve(shots, shot)).toString("base64")}`;
    const short = await tab.evaluate(
      async ({ data, top, s, w, h }) => {
        const img = new Image();
        img.src = data;
        await img.decode();
        const c = document.querySelector(".screen canvas");
        c.width = w * s;
        c.height = h * s;
        c.getContext("2d").drawImage(img, 0, top * s, w * s, h * s, 0, 0, w * s, h * s);
        return img.naturalHeight < (top + h) * s;
      },
      { data, top, s: SCALE, w: SCREEN.width, h: SCREEN.height },
    );
    if (short) throw new Error(`${name}: ${shot} is shorter than the crop`);
    await tab.evaluate(() => document.fonts.ready);
    const over = await tab.evaluate(
      () => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
    );
    if (over) throw new Error(`${name}: content overflows the canvas`);
    const out = resolve(outDir, `gallery-${name}.png`);
    writeFileSync(out, await tab.screenshot({ type: "png" }));
    const bytes = statSync(out).size;
    if (bytes > maxBytes) throw new Error(`${out}: ${bytes} bytes > ${maxBytes}`);
    console.log(`wrote ${out}: ${bytes} bytes`);
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
