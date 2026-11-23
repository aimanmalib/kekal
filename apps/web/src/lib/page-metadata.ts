// Request-aware metadata shared by the root layout and every page segment. Pages must export it too: Next.js
// replaces a segment's Open Graph images with the opengraph-image file (which has no alt text) unless that
// segment's own metadata lists images. site.ts stays free of next/headers so unit tests can import it.
import type { Metadata } from "next";
import { translator } from "./i18n";
import { requestLang } from "./request-lang";
import { pageMetadata } from "./site";

/** Title, description and link-preview tags in the reader's language (lang cookie). */
export async function localeMetadata(): Promise<Metadata> {
  const lang = await requestLang();
  return pageMetadata(translator(lang), lang);
}
