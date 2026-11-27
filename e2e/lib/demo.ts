// Helpers for the /demo scenes, shared by the demo test and the footage filmed on the public site.
import type { Locator, Page } from "@playwright/test";
import { e2e, pattern, text, type Lang } from "./env";

export const sceneOf = (page: Page, lang: Lang, kind: "silent" | "closed"): Locator =>
  page.locator("section.scene").filter({ has: page.getByRole("heading", { name: text(lang, `demo.${kind}.title`) }) });

/** Presses whichever "anyone may send this now" button the scene shows, until the scene reports the payout. When filming,
 * `pauseMs` holds on the button (pointer over it) before the press, so the shot shows it. */
export async function settleUntilPaid(page: Page, scene: Locator, lang: Lang, buttons: string[], pauseMs = 0): Promise<void> {
  const paid = scene.locator("p.ok", { hasText: pattern(lang, "demo.paid") });
  const deadline = Date.now() + e2e.testTimeoutSecs * 1000;
  while (!(await paid.isVisible())) {
    if (Date.now() > deadline) throw new Error("scene did not reach the payout");
    // The scene re-renders as the chain moves (the button may vanish between a check and a click), so look only for an
    // enabled button right now and try one short click; the loop comes back for anything missed.
    for (const key of buttons) {
      const button = scene.getByRole("button", { name: text(lang, key), disabled: false });
      if ((await button.count()) === 0) continue;
      if (pauseMs) await button.first().hover({ timeout: 5000 }).then(() => page.waitForTimeout(pauseMs), () => undefined);
      await button.first().click({ timeout: 5000 }).catch(() => undefined);
    }
    await page.waitForTimeout(1000);
  }
}

/** Each step the scene lists with its explorer link, in order: [step text, explorer URL]. */
export async function sceneSteps(scene: Locator): Promise<[string, string][]> {
  return scene
    .locator("ol.steps li")
    .evaluateAll((items) =>
      items.map((li) => [li.textContent?.trim() ?? "", li.querySelector("a[href*='explorer']")?.getAttribute("href") ?? ""] as [string, string]),
    );
}
