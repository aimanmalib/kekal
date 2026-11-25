// Browser end-to-end tests. Run through scripts/e2e.sh, which starts a local validator, writes sample warranties and
// test wallets, and serves the built web app on config/e2e.json `port`.
import { defineConfig, devices } from "@playwright/test";
import { e2e } from "./lib/env";

export default defineConfig({
  testDir: "tests",
  // One worker: the tests share one validator and the demo routes limit sessions per caller.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  // Recording (E2E_VIDEO) encodes every page while the test runs; on a busy host that needs more time per test.
  timeout: e2e.testTimeoutSecs * 1000 * (process.env.E2E_VIDEO ? 3 : 1),
  expect: { timeout: e2e.actionTimeoutSecs * 1000 },
  reporter: [["list"]],
  outputDir: process.env.E2E_OUTPUT ?? "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${e2e.port}`,
    actionTimeout: e2e.actionTimeoutSecs * 1000,
    navigationTimeout: e2e.actionTimeoutSecs * 1000,
    trace: "off",
    // E2E_SLOWMO_MS slows every browser action down, so a recorded run (E2E_VIDEO) can be followed by eye.
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO_MS || 0) },
  },
  projects: e2e.projects.map((p) => ({
    name: p.name,
    use: { ...devices[p.device], browserName: p.browser, walletIndex: p.wallet },
  })),
});
