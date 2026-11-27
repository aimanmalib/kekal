# ADR 0028: Demo footage filmed on the public devnet site

- Status: accepted
- Date: 2026-11-27

## Context

The second cut (ADR 0024) still showed the two demo paths and the shop board from a local test validator, with labels
such as "Test shop with a 5-second answer window", and the buyer's phone in Bahasa Melayu. Viewers could not tell that
what they saw was the public site, and the phone was too small to read.

## Decision

- **Every product shot of the third cut is filmed on the public site** (devnet), English UI throughout:
  `e2e/tests/film-live.spec.ts` films `/demo` paths B and C and the buyer's card page in WebKit (iPhone 13), and `/contoh`
  (paths A and D, one public record opened) and the shop board in Chromium. It runs only when `E2E_VIDEO` and
  `E2E_FILM_LIVE` are set, so normal test runs stay on the local validator.
- **Shots are paced for the cut, not for speed**: typing, holds on the countdown, on the "anyone can press" button and on
  the payout come from `scripts/video/demo-cut.json` (`liveFootage`). The countdown is kept in the middle of the screen
  so the cut can crop to it.
- **The shop board uses a fresh devnet test key** passed in `E2E_KEYS` with `E2E_WALLET_CHAIN=solana:devnet`; it holds
  only devnet SOL and test kUSD and is not a role key of the site. The printed card it issues is the A6 card shown full
  screen.
- **Explorer shots follow the filmed run**: the spec writes the demo transactions to `live-run.json` in the footage
  folder, and `film-explorer.spec.ts` films those payouts (`explorerFootage.liveShots`) next to the example-run shots.
- **Each live path is filmed at most three times per session**, because the site and the filming host share one
  network address and the public devnet endpoints rate-limit it.

## Consequences

The footage matches what a judge sees when opening the site. Filming spends a few devnet fees from the demo shop and the
relayer (shown in `/api/health`). If the live demo is down, the footage cannot be refreshed until it is back.
