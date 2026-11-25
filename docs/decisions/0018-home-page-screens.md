# ADR 0018: Home page steps use real screens from the browser tests

- Status: accepted
- Date: 2026-11-25

## Context

The home page explains the product in three steps (shop issues a card, buyer opens it, buyer is paid). Drawn
illustrations would show a product that might not match the app. The container runs the Next.js standalone server
with no image optimiser configured, and the page has to read in English and Bahasa Melayu.

## Decision

- **Screens come from the e2e run.** `scripts/e2e.sh` with `E2E_SHOTS` saves full-page WebKit iPhone 13 screenshots;
  `E2E_LANG` runs the shop test in the other language. `scripts/home-shots.py` crops one phone screen (390 x 780 CSS
  px) from each and stores it at 2x as AVIF and WebP in `apps/web/src/media/how/`, one set per language.
- **Plain `<picture>`, not `next/image`.** The files are already sized and encoded; a static import gives them hashed
  URLs under `/_next/static/media/`, so a cache in front of the site never serves an old image after a change. Width
  and height are set to avoid layout shift, and the images load lazily below the first screen.
- **The Limits list on the page matches the README.** A unit test compares the number of items.

## Consequences

A layout change on `/kedai`, `/w` or `/demo` leaves the home page screens out of date until the two e2e runs and
`home-shots.py` are repeated; the crop offsets in that script are checked by eye. The screens show a local validator
(the card link reads `localhost`), which the caption under the steps says.
