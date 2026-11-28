// Footage for the demo video filmed on the public site (devnet), only when E2E_VIDEO and E2E_FILM_LIVE are set and
// E2E_BASE_URL is the public site. English UI throughout. Pauses come from scripts/video/demo-cut.json `liveFootage`.
// Each run spends devnet fees from the demo shop and the relayer, so film each path at most a few times.
// What the later shots need from the earlier ones (the card link, the transactions) goes to <E2E_VIDEO>/live-run.json,
// which film-explorer.spec.ts reads to film those transactions in Chromium.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { sceneOf, sceneSteps, settleUntilPaid } from "../lib/demo";
import { e2e, pattern, text, videoDir, walletKeyName, type Lang } from "../lib/env";
import { glide } from "../lib/film";
import { newContext, TEST_WALLET_NAME } from "../lib/wallet";
import { closeContext, deviceOptions, expect, test } from "../lib/test";

const root = resolve(import.meta.dirname, "..", "..");
interface LiveFootage {
  typeDelayMs: number;
  holdSecs: { open: number; step: number; button: number; paid: number; steps: number; example: number; record: number; card: number };
  examplePaths: string[];
  countdownFromTop: number;
  shopPage: string;
}
const footage = (JSON.parse(readFileSync(join(root, "scripts", "video", "demo-cut.json"), "utf8")) as { liveFootage: LiveFootage })
  .liveFootage;
const lang: Lang = "en";
const t = (key: string, vars?: Record<string, string | number>) => text(lang, key, vars);
const hold = (page: Page, secs: number) => page.waitForTimeout(secs * 1000);

type LiveRun = Record<string, unknown>;
const runFile = () => join(videoDir()!, "live-run.json");
const readRun = (): LiveRun => (existsSync(runFile()) ? (JSON.parse(readFileSync(runFile(), "utf8")) as LiveRun) : {});
const saveRun = (part: LiveRun) => writeFileSync(runFile(), JSON.stringify({ ...readRun(), ...part }, null, 2));

/** Scrolls so the element sits `fromTop` (share of the screen height) below the top of the screen. */
async function bringUp(page: Page, selector: ReturnType<Page["locator"]>, ms = 1500, fromTop = 0.04): Promise<void> {
  const top = await selector.evaluate((el, f) => el.getBoundingClientRect().top + window.scrollY - window.innerHeight * f, fromTop);
  await glide(page, Math.max(0, top), ms);
}

/** Once the scene shows its countdown, keeps it in the middle of the screen with the steps above and the button below. */
async function followCountdown(page: Page, scene: ReturnType<Page["locator"]>): Promise<void> {
  const countdown = scene.locator("p.countdown");
  // A scene that is already due shows its button instead; then there is nothing to follow.
  const shown = await countdown.waitFor({ timeout: 30_000 }).then(() => true, () => false);
  if (shown) await bringUp(page, countdown, 1200, footage.countdownFromTop).catch(() => undefined);
}

test.beforeEach(async () => {
  test.skip(!videoDir() || !process.env.E2E_FILM_LIVE, "live footage is only filmed when E2E_VIDEO and E2E_FILM_LIVE are set");
});

const phoneOnly = (info: { project: { name: string } }) =>
  test.skip(e2e.projects.find((p) => p.name === info.project.name)?.browser !== "webkit", "phone footage is filmed in WebKit");
const desktopOnly = (info: { project: { name: string } }) =>
  test.skip(e2e.projects.find((p) => p.name === info.project.name)?.browser !== "chromium", "desktop footage is filmed in Chromium");

for (const kind of ["silent", "closed"] as const) {
  test(`film live: demo ${kind === "silent" ? "B, the shop ignores a claim" : "C, the shop stops checking in"}`, async ({ browser, baseURL }, info) => {
    phoneOnly(info);
    const { context } = await newContext(browser, { lang, baseURL: baseURL!, options: deviceOptions(info) });
    const page = await context.newPage();
    await page.goto("/demo");
    const scene = sceneOf(page, lang, kind);
    await bringUp(page, scene);
    await hold(page, footage.holdSecs.open);
    await scene.getByRole("button", { name: t(`demo.${kind}.start`) }).click();
    if (kind === "silent") {
      await expect(scene.getByText(t("demo.silent.claimHint"))).toBeVisible();
      await hold(page, footage.holdSecs.step);
      await scene.getByLabel(t("claim.description")).pressSequentially(e2e.claimText, { delay: footage.typeDelayMs });
      await scene.getByRole("button", { name: t("claim.submit") }).click();
      await expect(scene.locator("ol.steps").getByText(t("event.ClaimFiled"))).toBeVisible();
      await followCountdown(page, scene);
      await settleUntilPaid(page, scene, lang, ["settle.settleUnanswered.button"], footage.holdSecs.button * 1000);
    } else {
      await expect(scene.locator("ol.steps").getByText(t("event.WarrantyIssued"))).toBeVisible();
      await followCountdown(page, scene);
      await settleUntilPaid(page, scene, lang, ["settle.declareDormant.button", "settle.claimOrphan.button"], footage.holdSecs.button * 1000);
    }
    await expect(scene.locator("p.ok", { hasText: pattern(lang, "demo.paid") })).toBeVisible();
    await hold(page, footage.holdSecs.paid);
    await bringUp(page, scene.locator("ol.steps"));
    await hold(page, footage.holdSecs.steps);
    saveRun({ [`demo-${kind}`]: await sceneSteps(scene) });
    await closeContext(context, info, `live-demo-${kind}`);
  });
}

test("film live: finished examples A and D, one public record", async ({ browser, baseURL }, info) => {
  desktopOnly(info);
  const { context } = await newContext(browser, { lang, baseURL: baseURL!, options: deviceOptions(info) });
  const page = await context.newPage();
  await page.goto("/contoh", { waitUntil: "networkidle" });
  await hold(page, footage.holdSecs.open);
  for (const id of footage.examplePaths) {
    await bringUp(page, page.locator(`#path-${id}`));
    await hold(page, footage.holdSecs.example);
  }
  const last = page.locator("section.example", { has: page.locator(`#path-${footage.examplePaths.at(-1)}`) });
  const record = last.getByRole("link", { name: t("timeline.record") }).first();
  await record.hover();
  const opened = context.waitForEvent("page");
  await record.click();
  const explorer = await opened;
  await explorer.waitForLoadState("networkidle").catch(() => undefined);
  await hold(explorer, footage.holdSecs.record);
  await closeContext(context, info, "live-examples");
});

test("film live: the shop board deposits and issues a card", async ({ browser, baseURL }, info) => {
  desktopOnly(info);
  const seller = await newContext(browser, { lang, baseURL: baseURL!, keyName: walletKeyName(0), options: deviceOptions(info) });
  const shop = await seller.context.newPage();
  await shop.goto("/kedai");
  await hold(shop, footage.holdSecs.step);
  await shop.getByRole("button", { name: TEST_WALLET_NAME }).click();
  const open = shop.getByRole("button", { name: t("kedai.open.submit") });
  const reserve = shop.getByRole("heading", { name: t("kedai.reserve.heading") });
  await expect(open.or(reserve).first()).toBeVisible();
  if (await open.isVisible()) await open.click();
  await expect(reserve).toBeVisible();
  await bringUp(shop, reserve);
  await shop.getByLabel(pattern(lang, "kedai.funds.amount")).pressSequentially(e2e.seller.deposit, { delay: footage.typeDelayMs });
  await shop.getByRole("button", { name: t("kedai.funds.deposit") }).click();
  await expect(shop.locator(".figures dd").first()).toContainText(e2e.seller.deposit);
  await hold(shop, footage.holdSecs.step);
  await shop.getByRole("button", { name: t("kedai.alive.submit") }).click();
  await expect(shop.locator(".ok").first()).toBeVisible();
  const product = shop.getByLabel(t("kedai.issue.product"));
  await bringUp(shop, product);
  await product.pressSequentially(e2e.seller.product, { delay: footage.typeDelayMs });
  await shop.getByLabel(t("kedai.issue.serial")).pressSequentially(e2e.seller.serial, { delay: footage.typeDelayMs });
  await shop.getByRole("button", { name: t("kedai.issue.submit") }).click();
  const issued = shop.locator(".issued");
  await expect(issued.locator("h3")).toBeVisible();
  await bringUp(shop, issued);
  await hold(shop, footage.holdSecs.card);
  const pdf = shop.waitForEvent("download");
  await shop.getByRole("button", { name: t("kedai.card.pdf") }).click();
  await (await pdf).saveAs(join(videoDir()!, "live-card.pdf"));
  saveRun({ cardLink: await issued.locator("input").inputValue(), shopOwner: seller.address });
  await hold(shop, footage.holdSecs.step);
  await closeContext(seller.context, info, "live-kedai-seller");
});

test("film live: the buyer opens the card on a phone", async ({ browser, baseURL }, info) => {
  phoneOnly(info);
  const link = readRun().cardLink;
  test.skip(typeof link !== "string", "film the shop board first: live-run.json has no card link");
  const { context } = await newContext(browser, { lang, baseURL: baseURL!, options: deviceOptions(info) });
  const card = await context.newPage();
  await card.goto(link as string);
  await expect(card.getByText(e2e.seller.product).first()).toBeVisible();
  await hold(card, footage.holdSecs.card);
  const end = await card.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  await glide(card, end * 0.5, 3000);
  await hold(card, footage.holdSecs.step);
  await bringUp(card, card.getByRole("button", { name: t("panel.activate") }));
  await card.getByRole("button", { name: t("panel.activate") }).click();
  await expect(card.getByText(t("panel.holder"))).toBeVisible();
  await hold(card, footage.holdSecs.paid);
  await closeContext(context, info, "live-buyer");
});

test("film live: the public shop page on a phone", async ({ browser, baseURL }, info) => {
  phoneOnly(info);
  const { context } = await newContext(browser, { lang, baseURL: baseURL!, options: deviceOptions(info) });
  const page = await context.newPage();
  await page.goto(footage.shopPage);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("shopPage.title"));
  await hold(page, footage.holdSecs.open);
  await bringUp(page, page.getByRole("heading", { name: t("shopPage.reserve.heading") }), 1800);
  await hold(page, footage.holdSecs.step);
  await bringUp(page, page.getByRole("heading", { name: t("shopPage.windows.heading") }), 1800);
  await hold(page, footage.holdSecs.step);
  const slip = page.getByRole("img", { name: t("shopPage.slip.qrAlt") });
  await bringUp(page, slip, 1800, 0.3);
  await hold(page, footage.holdSecs.card);
  await closeContext(context, info, "live-shop-page");
});
