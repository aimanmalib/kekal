// The public page of a shop (/kedai/<owner>) on a phone in both languages: it fits 390 and 320 px after scrolling and
// with the technical details open, every figure links to the explorer, the warranty page links to it, and an address
// with no shop gets the designed not-found page with status 404.
import { e2e, fixtures, LANGS, text } from "../lib/env";
import { newContext } from "../lib/wallet";
import { deviceOptions, expect, expectNoOverflow, shot, test } from "../lib/test";

for (const lang of LANGS) {
  test(`public shop page in ${lang}`, async ({ browser, baseURL }, info) => {
    const fx = fixtures();
    const path = `/kedai/${fx.shopOwner}`;
    const { context } = await newContext(browser, { lang, baseURL: baseURL!, options: deviceOptions(info) });
    const page = await context.newPage();

    const card = fx.cards[0]!;
    await page.goto(`/w/${card.warranty}${card.fragment}`);
    await page.getByRole("link", { name: text(lang, "warranty.shopLink") }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(text(lang, "shopPage.title"));

    const figures = page.locator(".fig-link");
    expect(await figures.count()).toBeGreaterThanOrEqual(12);
    for (const href of await figures.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      expect(href).toContain("explorer.solana.com/address/");
    }
    await expect(page.getByRole("img", { name: text(lang, "shopPage.slip.qrAlt") })).toBeVisible();

    for (const width of e2e.overflowWidths) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.getByText(text(lang, "tech.summary")).click();
      await expectNoOverflow(page, `${lang} ${width}px ${path}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, info, `${lang}-${width}-shop-page`);
    }

    const missing = await page.goto(`/kedai/${fx.programId}`);
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(text(lang, "shopPage.missing.not_found.title"));
    const bad = await page.goto("/kedai/not-an-address");
    expect(bad?.status()).toBe(404);
    await context.close();
  });
}
