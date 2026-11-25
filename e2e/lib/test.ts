// Shared test fixture: which test wallet this project uses (config/e2e.json `projects[].wallet`), plus small page checks.
import { devices, expect, test as base, type BrowserContextOptions, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";
import { e2e, LANGS, shotDir, type Lang } from "./env";

export const test = base.extend<Record<never, never>, { walletIndex: number }>({
  walletIndex: [0, { option: true, scope: "worker" }],
});
export { expect };

/** Fails when the page scrolls sideways (document wider than the viewport). Returns [scrollWidth, clientWidth]. */
export async function expectNoOverflow(page: Page, label: string): Promise<[number, number]> {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth] as [number, number]);
  expect(w[0], `${label}: horizontal overflow ${w[0]} > ${w[1]}`).toBeLessThanOrEqual(w[1]);
  return w;
}

/** Full-page screenshot named after the project, into the evidence folder or the test output folder. */
export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const dir = shotDir();
  const file = `${info.project.name}-${name}.png`;
  await page.screenshot({ path: dir ? join(dir, `e2e-${file}`) : info.outputPath(file), fullPage: true });
}

/** Context options of this project's emulated device (viewport, user agent, touch), for contexts a test opens itself. */
export function deviceOptions(info: TestInfo): BrowserContextOptions {
  const project = e2e.projects.find((p) => p.name === info.project.name);
  if (!project) throw new Error(`config/e2e.json has no project ${info.project.name}`);
  const options: BrowserContextOptions & { defaultBrowserType?: string } = { ...devices[project.device]! };
  delete options.defaultBrowserType;
  return options;
}

/** The language this project's seller and arbiter run uses (config/e2e.json `projects[].lang`; E2E_LANG overrides it,
 * e.g. to take the same phone screenshots in the other language). */
export function projectLang(info: TestInfo): Lang {
  const project = e2e.projects.find((p) => p.name === info.project.name);
  if (!project) throw new Error(`config/e2e.json has no project ${info.project.name}`);
  const override = process.env.E2E_LANG;
  if (!override) return project.lang;
  if (!LANGS.includes(override as Lang)) throw new Error(`E2E_LANG=${override} is not one of ${LANGS.join(", ")}`);
  return override as Lang;
}
