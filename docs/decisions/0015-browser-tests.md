# ADR 0015: Browser end-to-end tests

- Status: accepted
- Date: 2026-11-23

## Context

The demo, the warranty page and the shop and arbiter boards were checked by hand-run browser scripts. Before the app is
deployed, one repeatable command should drive the real pages in a desktop browser and in WebKit on a phone-sized screen,
against a real (local) validator, in both languages.

## Decision

- **Playwright Test in its own workspace package `e2e/`**, pinned to one exact version so the browsers it downloads stay
  the same. Two projects from `config/e2e.json`: Chromium (Desktop Chrome) and WebKit (iPhone 13). Not part of
  `pnpm test`: it needs a validator, a built app and browsers.
- **`scripts/e2e.sh` owns the setup**: a throwaway validator (the start-up code is shared with `scripts/localnet.sh` in
  `scripts/lib/validator.sh`), `scripts/page-fixtures.ts` for sample warranties and one test wallet per project
  (`--wallets`), then `next build` and `next start` on the configured port, then the tests. `next dev` is not used: it
  recompiles on first visit and makes timings on a busy machine unpredictable. Everything is removed on exit.
- **Wallet Standard test wallet injected into the page.** It registers like a browser extension; each signature is made in
  the test process with Node's ed25519 and the key never enters the page.
- **UI text is read from `locales/*.json`**, not repeated in the tests, so a copy edit cannot break them; a missing key
  fails loudly.
- **One worker, no retries.** The tests share one validator and the demo routes limit sessions per caller. A flaky step is
  a bug to fix, not to retry.
- **Overflow check**: every page in both languages at each width in `config/e2e.json` must have `scrollWidth` no larger
  than `clientWidth`, after scrolling to the bottom and with the warranty's technical details opened.

## Consequences

- A full run takes several minutes on a shared machine; one project can be run alone with `--project=<name>`.
- The tests need `target/deploy/kekal.so` from `anchor build` and the Playwright browsers in the local cache.
