# ADR 0030: Language from the link, live home screens, favicon.ico

- Status: accepted
- Date: 2026-11-27

## Context

The README offered `?lang=ms` for Bahasa Melayu, but the site chose the language only from the saved cookie and the
browser's Accept-Language, so the link opened the English page. The home page "How it works" screens came from
browser tests on a local validator, and one of them showed a `localhost` card link. `/favicon.ico` answered 404, and the
"Public record" links in "See it happen" were 19 px tall text.

## Decision

- A valid `?lang=<code>` (parameter name in `config/app.json` `web.locales.queryParam`) wins for that request and is saved
  in the language cookie. A Next.js proxy (`apps/web/src/proxy.ts`) passes it to the page in a request header and drops
  that header when a client sends it without the query. The language switch removes the parameter from the address, so
  the reader's new choice is not overridden by an old link.
- The six "How it works" crops are taken on the public devnet site (`e2e/tests/home-shots-live.spec.ts` for the shop and
  card screens, `e2e/tests/demo.spec.ts` for the paid screens) with a devnet test shop key, and the caption says so.
- `favicon.ico` (16, 32 and 48 px PNG entries) is drawn from `apps/web/src/app/icon.svg` by `brand/render-icons.mjs`,
  sizes in `web.site.faviconIco`. The small icon is used rather than `brand/logo.svg` because its letter is a path and
  does not depend on a font at 16 px.
- Links in "See it happen" sit on their own line with a 44 px touch target.

## Consequences

Shared links can name the language. Rolling back the language change = delete the proxy and the header read in
`request-lang.ts`; the cookie behaviour is unchanged.
