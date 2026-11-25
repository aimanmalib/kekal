# Kekal design brief

The web app shows one thing above all: a warranty card that keeps its promise after the shop stops answering. Buyers
open it on a phone from a printed QR code; judges open it on a laptop with no wallet. The look is **certificate and
stamp**: paper, ink, a fine engraved band, and a rubber stamp when money arrives.

## Who and what

| Page | Reader | First job |
|---|---|---|
| `/w/[pda]` | buyer, phone, often outside a shop | see the reserve, the deadline and what to do next |
| `/demo`, `/contoh` | judge, laptop | watch a claim get paid without a wallet |
| `/kedai`, `/timbang` | seller, arbiter, wallet on desktop | manage reserve, issue cards, answer claims |
| `/` | anyone | understand the three rules in ten seconds |

## Tokens (`apps/web/src/app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `--paper` | `#faf8f1` | page and card face: warm white, not cream |
| `--paper-band` | `#f3eedf` | engraved band behind the guilloche |
| `--ink` | `#143829` | text, card border (12.1:1 on paper) |
| `--ink-soft` | `#4a5c52` | secondary text (6.7:1) |
| `--rule` | `#c8c1a9` | hairlines and the inner certificate frame; never text |
| `--copper` | `#a3521c` | stamps, status, focus ring only (5.2:1) |

No other colours. No gradients, no dark theme in v1, no purple or neon. Shadows only as the inset double frame of the
card.

**Type.** Display: Newsreader (variable, optical sizes) for headings, the card title and the stamp. UI: Public Sans
(variable) for labels, buttons and body. Numbers, amounts and hashes: IBM Plex Mono with tabular figures. All three are
self-hosted through `@fontsource` packages (OFL); the browser never calls a font CDN. Scale: 0.875 / 1 / 1.1875 / 1.5 /
clamp(2, 3.25) rem. Serif reading text gets 1.55 line height; lines stay under 34 rem.

**Space.** 0.5 / 1 / 1.5 / 2.5 / 4 rem. Touch targets at least 44 px (`--tap`).

## The card

- One object, reused on the home page, the warranty page, the PNG card and the A6 PDF.
- Top: a band of interlaced sine lines (`Guilloche` component, drawn on the server, deterministic). It is the one
  decorative element in the product; nothing else gets ornament.
- Body: a double frame (ink border plus inset rule), the title in italic serif, fields as a definition list, the
  reserve in mono.
- Outcome: a round copper stamp, slightly rotated, with the paid status word. It appears only when money has moved.
- Printed card (`/kedai`): the same band, frame and fields on an A6 page per language, with the QR code centred; the
  PNG and PDF read the colour tokens from the page at download time, so they never drift from the CSS.
- Boards (`/kedai`, `/timbang`): sections separated by hairlines, figures as label over a mono number in a hairline
  grid, the newly issued card in the double frame. No cards-in-cards, no tinted panels.

## Layout

Mobile first at 390 px (checked down to 320 px). Home page, one column: masthead with the mark, reviewer links (video,
source code, program; each shown only once it exists), title, the sample card on a drawn phone, lede, the three rules.
On an iPhone 13 the paid stamp sits inside the first screen. From 56 rem the text takes the left column and the phone
the right, text left-aligned. The phone is an ink body around a paper screen, borders only, no shadow and no image.
The mark (`brand/logo.svg`, simplified) is drawn inline in the page tokens, in the masthead and the footer. Grid children carry
`min-width: 0`; flex children that hold long values (addresses, hashes) carry `max-width: 100%` and break with
`overflow-wrap: anywhere`.

## Motion

Only two moments move: the claim countdown and the stamp landing when a payment arrives (scale and rotate, under
400 ms). No entrance animations, no hover lifts. `prefers-reduced-motion` turns both into instant changes. Never
animate `filter` or `backdrop-filter` (WebKit crashes); no `backdrop-filter` on headers or menus at all.

## Words

- All UI text lives in `locales/en.json` and `locales/ms.json` with identical keys (a unit test enforces it).
  Language: saved choice, then the browser's `Accept-Language`, then English. The switch is two buttons, not a flag.
- Buyer pages never say blockchain, wallet or token outside the collapsed "Technical details" section.
- Sentence case, plain verbs, no all-caps labels, no arrows appended to links. Errors say what happened and what to
  do next.
- Amounts in USD (kUSD) with an approximate ringgit figure labelled as an estimate; the rate lives in config.
- The promise described is the shop's own promise to install and service. Kekal does not replace or judge the
  manufacturer's warranty.

## Do not

- Templated SaaS cards with identical radius and grey shadows; eyebrow labels over every heading; numbered markers
  for content that is not a sequence.
- Hard-coded colours, sizes or copy outside tokens and locale files.
- Third-party fonts, trackers or analytics scripts.
