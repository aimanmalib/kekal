// Screens for the home page "How it works" (scripts/home-shots.py), taken on the public site (devnet) so no local
// address shows: per language, the shop board issues a card and the buyer activates and claims it on a phone.
// Runs only when E2E_HOME_SHOTS=1 and E2E_SHOTS is set, with E2E_BASE_URL = the public site and E2E_KEYS +
// E2E_WALLET_CHAIN naming a devnet test shop key. Each card deposits e2e.seller.deposit test tokens first and spends
// devnet fees: run it once. The "paid" screens come from demo.spec.ts run against the same site.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { e2e, LANGS, pattern, shotDir, text, walletKeyName } from "../lib/env";
import { newContext, TEST_WALLET_NAME } from "../lib/wallet";
import { closeContext, deviceOptions, expect, expectNoOverflow, shot, test } from "../lib/test";

test.beforeEach(async ({ baseURL }, info) => {
  test.skip(process.env.E2E_HOME_SHOTS !== "1" || !process.env.E2E_SHOTS, "set E2E_HOME_SHOTS=1 and E2E_SHOTS");
  test.skip(!process.env.E2E_BASE_URL || (baseURL ?? "").includes("localhost"), "home screens are taken on the public site");
  test.skip(e2e.projects.find((p) => p.name === info.project.name)?.browser !== "webkit", "home screens are phone screens");
});

/** The public RPC can lag behind a fresh transaction and the warranty page then says the network is unreachable:
 * after a first normal wait (so a transaction still in flight is not cut off), reload until the element shows. */
async function reloadUntilShown(page: Page, target: Locator): Promise<void> {
  const shown = await target.waitFor({ timeout: 60_000 }).then(
    () => true,
    () => false,
  );
  if (shown) return;
  await expect(async () => {
    if (await target.isVisible()) return;
    await page.reload();
    await expect(target).toBeVisible({ timeout: 15_000 });
  }).toPass({ intervals: [5_000, 10_000, 20_000], timeout: 120_000 });
}

for (const lang of LANGS) {
  test(`home shots: the shop issues a card and the buyer claims (${lang})`, async ({ browser, baseURL }, info) => {
    const t = (key: string, vars?: Record<string, string | number>) => text(lang, key, vars);
    const options = deviceOptions(info);
    // The card link (a devnet test card) is kept next to the screenshots, so a rerun after a failed buyer step reuses
    // the issued card instead of issuing another.
    const linkFile = join(shotDir()!, `${lang}-card-link.txt`);

    if (!existsSync(linkFile)) {
      const seller = await newContext(browser, { lang, baseURL: baseURL!, keyName: walletKeyName(0), options });
      const shop = await seller.context.newPage();
      await shop.goto("/kedai");
      await shop.getByRole("button", { name: TEST_WALLET_NAME }).click();
      const open = shop.getByRole("button", { name: t("kedai.open.submit") });
      const reserve = shop.getByRole("heading", { name: t("kedai.reserve.heading") });
      await expect(open.or(reserve).first()).toBeVisible();
      if (await open.isVisible()) await open.click();
      await expect(reserve).toBeVisible();
      await shop.getByLabel(pattern(lang, "kedai.funds.amount")).fill(e2e.seller.deposit);
      await shop.getByRole("button", { name: t("kedai.funds.deposit") }).click();
      await expect(shop.locator(".ok").first()).toBeVisible();
      await shop.getByRole("button", { name: t("kedai.alive.submit") }).click();
      await expect(shop.locator(".ok").first()).toBeVisible();
      await shop.getByLabel(t("kedai.issue.product")).fill(e2e.seller.product);
      await shop.getByLabel(t("kedai.issue.serial")).fill(e2e.seller.serial);
      await shop.getByRole("button", { name: t("kedai.issue.submit") }).click();
      const issued = shop.locator(".issued");
      await expect(issued.locator("h3")).toBeVisible();
      const link = await issued.locator("input").inputValue();
      expect(link).not.toContain("localhost");
      writeFileSync(linkFile, link);
      await shop.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expectNoOverflow(shop, "kedai after issue");
      await shot(shop, info, `${lang}-kedai-issued`);
      await closeContext(seller.context, info, `${lang}-home-seller`);
    }

    const buyer = await newContext(browser, { lang, baseURL: baseURL!, options });
    const card = await buyer.context.newPage();
    await card.goto(readFileSync(linkFile, "utf8").trim());
    await reloadUntilShown(card, card.getByText(e2e.seller.product).first());
    await card.getByRole("button", { name: t("panel.activate") }).click();
    // The new holder key stays in this browser, so a reload keeps the card.
    await reloadUntilShown(card, card.getByText(t("panel.holder")));
    await card.getByLabel(t("claim.description")).fill(e2e.claimText);
    await card.getByRole("button", { name: t("claim.submit") }).click();
    await expect(card.locator(".ok")).toBeVisible();
    await shot(card, info, `${lang}-buyer-claimed`);
    await closeContext(buyer.context, info, `${lang}-home-buyer`);
  });
}
