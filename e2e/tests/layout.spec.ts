// Every page in English and Bahasa Melayu at phone widths: the right language is served and nothing scrolls sideways,
// also after scrolling to the bottom and with the technical details of a warranty opened.
import { e2e, fixtures, LANGS, text } from "../lib/env";
import { newContext } from "../lib/wallet";
import { deviceOptions, expect, expectNoOverflow, shot, test } from "../lib/test";

for (const lang of LANGS) {
  test(`pages in ${lang} fit ${e2e.overflowWidths.join(" and ")} px`, async ({ browser, baseURL }, info) => {
    const card = fixtures().cards[0]!;
    const pages = [...e2e.overflowPages, `/w/${card.warranty}${card.fragment}`];
    const { context } = await newContext(browser, { lang, baseURL: baseURL!, options: deviceOptions(info) });
    const page = await context.newPage();
    for (const width of e2e.overflowWidths) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of pages) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expectNoOverflow(page, `${lang} ${width}px ${path}`);
      }
      // The warranty page last: open "Technical details" after scrolling, the widest content on any buyer page.
      await page.getByText(text(lang, "tech.summary")).click();
      await expectNoOverflow(page, `${lang} ${width}px warranty with details open`);
      if (width === Math.min(...e2e.overflowWidths)) await shot(page, info, `${lang}-${width}-warranty`);
    }
    await page.goto("/demo");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(text(lang, "demo.title"));
    await context.close();
  });
}
