// Footage for the demo video, only when recording (E2E_VIDEO): the home page read from top to bottom at a calm pace,
// with the sample warranty card in the phone frame first. Skipped in normal test runs.
import { videoDir } from "../lib/env";
import { glide } from "../lib/film";
import { newContext } from "../lib/wallet";
import { closeContext, deviceOptions, expect, test } from "../lib/test";

test("film: the home page from top to bottom", async ({ browser, baseURL }, info) => {
  test.skip(!videoDir(), "footage is only recorded when E2E_VIDEO is set");
  const { context } = await newContext(browser, { lang: "en", baseURL: baseURL!, options: deviceOptions(info) });
  const page = await context.newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".phone")).toBeVisible();
  await page.waitForTimeout(4000);
  // One screen at a time, with a pause on each, so any part can be cut out as its own shot.
  const screen = await page.evaluate(() => window.innerHeight);
  const end = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  for (let top = screen * 0.8; top < end; top += screen * 0.8) {
    await glide(page, Math.min(top, end), 1800);
    await page.waitForTimeout(2500);
  }
  await glide(page, end, 1200);
  await page.waitForTimeout(3000);
  await glide(page, 0, 2500);
  await page.waitForTimeout(3000);
  await closeContext(context, info, "home");
});
