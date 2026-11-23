// A seller with a browser wallet on /kedai, a buyer on a phone, the arbiter on /timbang, on a local validator:
// open a shop, deposit, check in, issue a card (PDF + PNG downloads), the buyer activates it and claims, the shop rejects,
// the buyer escalates and the arbiter pays the buyer.
import { readFileSync } from "node:fs";
import { e2e, LANGS, pattern, text, walletKeyName } from "../lib/env";
import { newContext, TEST_WALLET_NAME } from "../lib/wallet";
import { deviceOptions, expect, expectNoOverflow, projectLang, shot, test } from "../lib/test";

test("seller, buyer and arbiter settle a rejected claim", async ({ browser, baseURL, walletIndex }, info) => {
  const lang = projectLang(info);
  const t = (key: string, vars?: Record<string, string | number>) => text(lang, key, vars);
  const options = deviceOptions(info);

  // 1. The seller opens a shop, deposits, checks in and issues a card.
  const seller = await newContext(browser, { lang, baseURL: baseURL!, keyName: walletKeyName(walletIndex), options });
  const shop = await seller.context.newPage();
  await shop.goto("/kedai");
  await shop.getByRole("button", { name: TEST_WALLET_NAME }).click();
  await shop.getByRole("button", { name: t("kedai.open.submit") }).click();
  await expect(shop.getByRole("heading", { name: t("kedai.reserve.heading") })).toBeVisible();
  await shop.getByLabel(pattern(lang, "kedai.funds.amount")).fill(e2e.seller.deposit);
  await shop.getByRole("button", { name: t("kedai.funds.deposit") }).click();
  await expect(shop.locator(".figures dd").first()).toContainText(e2e.seller.deposit);
  await shop.getByRole("button", { name: t("kedai.alive.submit") }).click();
  await expect(shop.locator(".ok")).toBeVisible();
  await shop.getByLabel(t("kedai.issue.product")).fill(e2e.seller.product);
  await shop.getByLabel(t("kedai.issue.serial")).fill(e2e.seller.serial);
  await shop.getByRole("button", { name: t("kedai.issue.submit") }).click();
  await expect(shop.getByRole("heading", { name: t("kedai.card.heading", { id: 0 }) })).toBeVisible();

  const pdf = shop.waitForEvent("download");
  await shop.getByRole("button", { name: t("kedai.card.pdf") }).click();
  expect(readFileSync(await (await pdf).path()).subarray(0, 5).toString()).toBe("%PDF-");
  for (const l of LANGS) {
    const png = shop.waitForEvent("download");
    await shop.getByRole("button", { name: t("kedai.card.png", { lang: text(l, `lang.${l}`) }) }).click();
    expect(readFileSync(await (await png).path()).subarray(1, 4).toString()).toBe("PNG");
  }
  const link = await shop.locator(".issued input").inputValue();
  await shop.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expectNoOverflow(shop, "kedai after issue");
  await shot(shop, info, `${lang}-kedai-issued`);

  // 2. The buyer opens the card link on a phone, sees the promise, activates the card and claims.
  const buyer = await newContext(browser, { lang, baseURL: baseURL!, options });
  const card = await buyer.context.newPage();
  await card.goto(link);
  await expect(card.getByText(e2e.seller.product).first()).toBeVisible();
  await card.getByRole("button", { name: t("panel.activate") }).click();
  await expect(card.getByText(t("panel.holder"))).toBeVisible();
  await card.getByLabel(t("claim.description")).fill(e2e.claimText);
  await card.getByRole("button", { name: t("claim.submit") }).click();
  await expect(card.locator(".ok")).toBeVisible();

  // 3. The seller sees the claim and rejects it with a note.
  await shop.reload();
  await shop.getByRole("button", { name: TEST_WALLET_NAME }).click();
  await expect(shop.getByText(t("status.claim.pending")).first()).toBeVisible();
  await shop.getByLabel(t("kedai.claim.reason")).fill(e2e.rejectNote);
  await shop.getByRole("button", { name: t("kedai.claim.reject") }).click();
  await expect(shop.getByText(t("status.claim.rejected")).first()).toBeVisible();

  // 4. The buyer escalates; the arbiter rules for the buyer and the card shows the payout.
  await card.reload();
  await card.getByRole("button", { name: t("panel.escalate") }).click();
  await expect(card.locator(".ok")).toBeVisible();
  const arbiter = await newContext(browser, { lang, baseURL: baseURL!, keyName: "arbiter", options });
  const board = await arbiter.context.newPage();
  await board.goto("/timbang");
  await board.getByRole("button", { name: TEST_WALLET_NAME }).click();
  const warranty = new URL(link).pathname.split("/").pop()!;
  const row = board.locator("li").filter({ has: board.locator(`a[href="/w/${warranty}"]`) });
  await row.getByRole("button", { name: t("timbang.buyerWins") }).click();
  await expect(board.locator(".ok")).toBeVisible();
  await expectNoOverflow(board, "timbang after ruling");
  await card.reload();
  await expect(card.locator(".stamp")).toBeVisible();
  await expectNoOverflow(card, "warranty page paid");
  await shot(card, info, `${lang}-buyer-paid`);
  for (const c of [seller.context, buyer.context, arbiter.context]) await c.close();
});
