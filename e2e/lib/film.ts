// Helpers for filming footage for the demo video (E2E_VIDEO).
import type { Page } from "@playwright/test";

/** Scrolls the page to `top` over `ms` milliseconds with an eased animation inside the page (works with touch devices,
 * where wheel events are not available). */
export async function glide(page: Page, top: number, ms: number): Promise<void> {
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
