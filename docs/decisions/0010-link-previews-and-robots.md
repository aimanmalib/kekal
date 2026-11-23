# ADR 0010: Link previews and robots.txt

- Status: accepted
- Date: 2026-11-23

## Context

Judges and buyers meet Kekal as a link pasted into a chat, a post or a submission form. Without Open Graph tags and an
image the link unfurls as a bare URL. The site also needs a `robots.txt` that keeps crawlers off the API routes.

## Decision

- **One static image, `apps/web/src/app/opengraph-image.png` (1200 × 630)**, picked up by the Next.js file
  convention. Its alt text is `meta.ogAlt` in each locale file, never a `.alt.txt` beside the image (that file would
  be English-only UI text outside the locales). It is drawn by `brand/render-og.mjs` from the real
  stylesheet tokens, the self-hosted fonts, the warranty card markup and the English locale text, so it cannot drift
  from the design brief. The script fails if the content overflows the canvas or the file is larger than
  `web.site.ogImage.maxBytes` (300 KB). The image is committed; the build does not render it.
- **Metadata from `apps/web/src/lib/site.ts`**: `metadataBase` from `web.site.url` (overridden by `KEKAL_SITE_URL`),
  Open Graph title, description, site name and locale (`en_US` or `ms_MY`, the other as alternate) from the locale
  files, the card listed in `openGraph.images` and `twitter.images` with its configured size and the locale alt
  text, and a `summary_large_image` Twitter card. No canonical URL is set in the root layout, because it would point
  every page at the home page.
- **`robots.txt`**: every crawler may read pages but not `/api/`. The link-preview bots listed in
  `web.site.previewBots` get their own group with the same rules, so previews keep working if the default group is
  ever narrowed. The list and the paths live in `config/app.json`.

## Consequences

- Changing the headline or card text means running `node brand/render-og.mjs`, committing the new PNG and updating
  `meta.ogAlt` in both locales; a unit test checks its size, byte limit and alt text length.
- Next.js attaches the file-convention image to the leaf page segment and replaces `openGraph.images` there unless the
  page itself lists images. So the layout and every page export `generateMetadata` from one shared function
  (`src/lib/page-metadata.ts`), and each page renders exactly one `og:image` with the locale `og:image:alt`. A unit
  test fails if a page under `src/app` stops exporting metadata while the card file exists.
- Rejected: moving the card to `public/`. It would drop the content-hashed URL Next.js gives the file (a CDN can keep
  serving an old `.png` for hours after the card changes) and touch more files (render script, config, tests).
  Rollback: remove the export from a page; the card still shows, only without alt text.
- The robots test checks a fixed list of the bots the docs promise (WhatsApp, TelegramBot, Twitterbot, LinkedInBot,
  facebookexternalhit), so removing one from config fails the test.
- Only English text is in the image; the Malay page still gets Malay title and description tags.
