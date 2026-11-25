# ADR 0024: Explorer footage of the devnet run in the demo video

- Status: accepted
- Date: 2026-11-25

## Context

The first cut (ADR 0020) showed the program as a still card with its address, and its home-page shots came from a build
on a local test validator. With the program and the live site on devnet (ADR 0023), the video can show the same
transactions anyone can open in a public explorer.

## Decision

- **Three explorer shots replace the still card**: the deposit locked in the shop's vault, the payout to the buyer of a
  silent shop (token changes, then the program's `Reserve Paid` event), and the program account. They are taken from the
  devnet run in `config/examples.json`, the same run the `/contoh` page links to.
- **The shot list lives in the cut file** (`scripts/video/demo-cut.json`, `explorerFootage`): which transaction or
  address, where to scroll, how long to hold. `e2e/tests/film-explorer.spec.ts` films them only when `E2E_VIDEO` and
  `E2E_EXPLORER` are set, so normal test runs stay offline.
- **Chromium films the explorer.** The explorer's host turns headless WebKit away with a browser check; that check is not
  worked around. The 1280×720 frames are cropped to the content column and scaled to 1080p.
- **The home-page shots are filmed again from the live site**, so the opening and closing scenes say "Solana devnet". The
  two demo-path phone shots stay from the local run: they use a test shop with 5-second windows and their labels say so.

## Consequences

Re-filming after a new devnet run is one command plus picking in and out points. The video depends on a public explorer
being reachable while filming, not while playing. A unit test checks that every explorer scene has a shot and every shot
names a step or address in the examples file.
