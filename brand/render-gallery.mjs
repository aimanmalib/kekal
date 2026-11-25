// Draws the gallery images for the hackathon form from real screenshots of the app and the claim state diagram.
// Take the screenshots first (WebKit iPhone 13, English):
//   E2E_LANG=en E2E_SHOTS=<shots> bash scripts/e2e.sh --project=webkit-iphone13 -g "seller|path"
// then, from the repo root after `pnpm install`: node brand/render-gallery.mjs <shots> <out>   (needs Playwright with Chromium)
// Writes <out>/gallery-{buyer,shop,states}.png at web.site.gallery width x height. Colours and fonts come from
// apps/web/src/app/globals.css; no words are added, so captions live with the form text.
// Each phone screen is one 390 x 780 CSS px crop of a full-page screenshot, starting at the offset below. Offsets depend on
// the page layout: re-check them by eye after a layout change.
/* global console, document, innerWidth, innerHeight, process, Buffer, Image */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// CommonJS require so a global Playwright install is found through NODE_PATH.
const { chromium } = createRequire(import.meta.url)("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "apps/web");
const app = JSON.parse(readFileSync(resolve(root, "config/app.json"), "utf8"));
const { width, height } = app.web.site.gallery;

const SCALE = 3; // iPhone 13 device pixel ratio of the screenshots
const SCREEN = { w: 390, h: 780 }; // CSS px of one crop

// image: list of [screenshot, top of the crop in CSS px]
const IMAGES = {
  buyer: [
    ["e2e-webkit-iphone13-en-buyer-claimed.png", 545], // the buyer files a claim from the card page
    ["e2e-webkit-iphone13-demo-silent-paid.png", 875], // the shop stayed silent: the card is paid
  ],
  shop: [
    ["e2e-webkit-iphone13-en-kedai-issued.png", 505], // reserve deposited, check-in window
    ["e2e-webkit-iphone13-en-kedai-issued.png", 1300], // card issued with its QR code
  ],
};

const [shots, outDir] = process.argv.slice(2).map((p) => resolve(p));
if (!shots || !outDir) {
  console.error("usage: node brand/render-gallery.mjs <screenshots dir> <out dir>");
  process.exit(2);
}
for (const [file] of Object.values(IMAGES).flat()) {
  if (!existsSync(resolve(shots, file))) throw new Error(`missing screenshot ${file}; run the e2e command above first`);
}
mkdirSync(outDir, { recursive: true });

const css = (p) => `<link rel="stylesheet" href="${pathToFileURL(resolve(web, p)).href}">`;
const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
${css("src/app/globals.css")}
<style>
  html, body { width: ${width}px; height: ${height}px; margin: 0; overflow: hidden; background: var(--paper); }
  .frame { box-sizing: border-box; height: 100%; border-top: 14px solid var(--ink); display: flex;
           align-items: center; justify-content: center; gap: 72px; padding: 40px 64px; }
  .screen { width: ${SCREEN.w * 0.88}px; height: ${SCREEN.h * 0.88}px; border: 10px solid var(--ink);
            border-radius: 34px; overflow: hidden; background: var(--paper); flex: none; }
  .screen canvas { display: block; width: 100%; height: 100%; }
  .diagram { max-width: 100%; max-height: 100%; border-radius: 14px; }
</style></head><body><div class="frame">${body}</div></body></html>`;

const tmp = mkdtempSync(resolve(tmpdir(), "kekal-gallery-"));
const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const shoot = async (name, html, crops = []) => {
    const file = resolve(tmp, `${name}.html`);
    writeFileSync(file, html);
    await tab.goto(pathToFileURL(file).href, { waitUntil: "load" });
    // Crop on a canvas so the page needs no file paths beyond the stylesheet.
    for (const [i, [shot, top]] of crops.entries()) {
      const data = `data:image/png;base64,${readFileSync(resolve(shots, shot)).toString("base64")}`;
      await tab.evaluate(
        async ({ i, data, top, s, w, h }) => {
          const img = new Image();
          img.src = data;
          await img.decode();
          const c = document.querySelectorAll(".screen canvas")[i];
          c.width = w * s;
          c.height = h * s;
          c.getContext("2d").drawImage(img, 0, top * s, w * s, h * s, 0, 0, w * s, h * s);
        },
        { i, data, top, s: SCALE, w: SCREEN.w, h: SCREEN.h },
      );
    }
    await tab.evaluate(() => document.fonts.ready);
    const over = await tab.evaluate(
      () => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
    );
    if (over) throw new Error(`${name}: content overflows the canvas`);
    const out = resolve(outDir, `gallery-${name}.png`);
    writeFileSync(out, await tab.screenshot({ type: "png" }));
    console.log(`wrote ${out}`);
  };
  for (const [name, crops] of Object.entries(IMAGES)) {
    await shoot(name, page(crops.map(() => `<div class="screen"><canvas></canvas></div>`).join("")), crops);
  }
  const svg = readFileSync(resolve(root, "docs/media/states.svg"), "utf8");
  await shoot("states", page(`<img class="diagram" alt="" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`));
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
