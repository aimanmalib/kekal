// Full-page English screenshots of the read-only pages the hackathon form gallery crops (brand/render-gallery.mjs).
// Runs only when E2E_GALLERY=1 and E2E_SHOTS is set, usually against the live site with E2E_BASE_URL; it starts no demo run.
import { newContext } from "../lib/wallet";
import { closeContext, deviceOptions, shot, test } from "../lib/test";

const pages: [string, string][] = [
  ["/", "gallery-home"],
  ["/contoh", "gallery-contoh"],
  ["/kedai", "gallery-kedai"],
  ["/demo", "gallery-demo"],
];

test("gallery: read-only pages in English", async ({ browser, baseURL }, info) => {
  test.skip(process.env.E2E_GALLERY !== "1" || !process.env.E2E_SHOTS, "set E2E_GALLERY=1 and E2E_SHOTS");
  const { context } = await newContext(browser, { lang: "en", baseURL: baseURL!, options: deviceOptions(info) });
  const page = await context.newPage();
  for (const [path, name] of pages) {
    await page.goto(path, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await shot(page, info, name);
  }
  await closeContext(context, info, "gallery");
});
