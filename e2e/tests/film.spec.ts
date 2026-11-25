// Footage for the demo video, only when recording (E2E_VIDEO): the home page read from top to bottom at a calm pace,
// with the sample warranty card in the phone frame first. Skipped in normal test runs.
import type { Page } from "@playwright/test";
import { videoDir } from "../lib/env";
import { newContext } from "../lib/wallet";
import { closeContext, deviceOptions, expect, test } from "../lib/test";

/** Scrolls the page to `top` over `ms` milliseconds with an eased animation inside the page (works with touch devices,
 * where wheel events are not available). */
async function glide(page: Page, top: number, ms: number): Promise<void> {
  await page.evaluate(
    ([to, duration]) =>
      new Promise<void>((done) => {
        const from = window.scrollY;
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
          window.scrollTo(0, from + (to - from) * eased);
          if (t < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    [top, ms] as const,
  );
}

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
