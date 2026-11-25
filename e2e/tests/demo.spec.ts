// /demo with no wallet, on a local validator: path B (the shop never answers a claim) and path C (the shop stops checking
// in). Each scene ends with the reserve paid to the card key this browser made; every step links to its transaction.
import type { Locator, Page, TestInfo } from "@playwright/test";
import { e2e, pattern, text, type Lang } from "../lib/env";
import { newContext } from "../lib/wallet";
import { closeContext, deviceOptions, expect, expectNoOverflow, shot, test } from "../lib/test";

/** Presses whichever "anyone may send this now" button the scene shows, until the scene reports the payout. */
async function settleUntilPaid(page: Page, scene: Locator, lang: Lang, buttons: string[]): Promise<void> {
  const paid = scene.locator("p.ok", { hasText: pattern(lang, "demo.paid") });
  const deadline = Date.now() + e2e.testTimeoutSecs * 1000;
  while (!(await paid.isVisible())) {
    if (Date.now() > deadline) throw new Error("scene did not reach the payout");
    // The scene re-renders as the chain moves (the button may vanish between a check and a click), so look only for an
    // enabled button right now and try one short click; the loop comes back for anything missed.
    for (const key of buttons) {
      const button = scene.getByRole("button", { name: text(lang, key), disabled: false });
      if ((await button.count()) > 0) await button.first().click({ timeout: 5000 }).catch(() => undefined);
    }
    await page.waitForTimeout(1000);
  }
}

/** Prints the time from the scene's first click to the payout: the number docs/MEASURED.md quotes for the live demo. */
function reportPaid(info: TestInfo, path: string, startedAt: number): void {
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  info.annotations.push({ type: "first-click-to-paid-secs", description: secs });
  console.log(`demo ${path} ${info.project.name}: first click to paid ${secs} s`);
}

const sceneOf = (page: Page, lang: Lang, kind: "silent" | "closed") =>
  page.locator("section.scene").filter({ has: page.getByRole("heading", { name: text(lang, `demo.${kind}.title`) }) });

test("path B: the shop goes silent on a claim and the holder is paid (English)", async ({ browser, baseURL }, info) => {
  const lang: Lang = "en";
  const { context } = await newContext(browser, { lang, baseURL: baseURL!, options: deviceOptions(info) });
  const page = await context.newPage();
  await page.goto("/demo");
  const scene = sceneOf(page, lang, "silent");
  const startedAt = Date.now();
  await scene.getByRole("button", { name: text(lang, "demo.silent.start") }).click();
  await expect(scene.getByText(text(lang, "demo.silent.claimHint"))).toBeVisible();
  await scene.getByLabel(text(lang, "claim.description")).fill(e2e.claimText);
  await scene.getByRole("button", { name: text(lang, "claim.submit") }).click();
  await expect(scene.locator("ol.steps").getByText(text(lang, "event.ClaimFiled"))).toBeVisible();
  await settleUntilPaid(page, scene, lang, ["settle.settleUnanswered.button"]);
  await expect(scene.locator("ol.steps").getByText(text(lang, "event.ReservePaid"))).toBeVisible();
  await expect(scene.locator(".stamp")).toBeVisible();
  reportPaid(info, "B", startedAt);
  // Issued, card moved to this browser's key, claim filed, paid: each one a transaction with an explorer link.
  expect(await scene.locator("ol.steps li a[href*='explorer']").count()).toBeGreaterThanOrEqual(3);
  await expectNoOverflow(page, "demo B paid");
  await shot(page, info, "demo-silent-paid");
  await closeContext(context, info, "demo-silent");
});

test("path C: the shop stops checking in, is marked silent and the holder is paid (Bahasa Melayu)", async ({ browser, baseURL }, info) => {
  const lang: Lang = "ms";
  const { context } = await newContext(browser, { lang, baseURL: baseURL!, options: deviceOptions(info) });
  const page = await context.newPage();
  await page.goto("/demo");
  const scene = sceneOf(page, lang, "closed");
  const startedAt = Date.now();
  await scene.getByRole("button", { name: text(lang, "demo.closed.start") }).click();
  await expect(scene.locator("ol.steps").getByText(text(lang, "event.WarrantyIssued"))).toBeVisible();
  await settleUntilPaid(page, scene, lang, ["settle.declareDormant.button", "settle.claimOrphan.button"]);
  await expect(scene.locator("ol.steps").getByText(text(lang, "event.ShopDeclaredDormant"))).toBeVisible();
  await expect(scene.locator("ol.steps").getByText(text(lang, "event.ReservePaid"))).toBeVisible();
  reportPaid(info, "C", startedAt);
  await expectNoOverflow(page, "demo C paid");
  await shot(page, info, "demo-closed-paid");
  await closeContext(context, info, "demo-closed");
});
