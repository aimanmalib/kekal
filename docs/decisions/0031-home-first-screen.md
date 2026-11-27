# ADR 0031: Home first screen tells the story with the printed card

- Status: accepted
- Date: 2026-11-27

## Context

The first screen of the home page showed the title and the sample card on a phone. The demo button and the rules sat
below the fold on a phone, and the printed card a buyer actually keeps did not appear anywhere on the page.

## Decision

- In the first screen, in this order: the title, one sentence (`home.story`: if the shop goes silent, the buyer is paid),
  the demo button (or the finished examples while the program is not deployed), then the printed A6 card and the same
  card stamped Paid on the phone. On a phone they stack; from 56 rem the card sits behind the phone's left edge in the
  right column.
- The printed card is the real card layout (`cardOps` in `apps/web/src/lib/shop/card.ts`, the same operations the PDF and
  PNG files use), laid out on the server with the PDF's text measurer plus a 6% margin for the wider page fonts, and
  drawn as inline SVG whose colours and fonts are page tokens. No image file to keep in step with the CSS.
- Its QR code opens `/demo` on the public site once the program is deployed, the site itself before. The sample words
  (serial, promise, card id) are in the locale files; the promise names only the shop's installation and service.
- The lede, rules and live figures follow the first screen unchanged.

## Consequences

The button is visible on a 390 px phone without scrolling, and the card a shop would print is visible on every screen
size. Rolling back = restore the title-then-phone order in `apps/web/src/app/page.tsx` and drop `PrintedCard`.
