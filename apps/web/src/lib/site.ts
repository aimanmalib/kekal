// Public address, robots rules and link-preview metadata. Values come from config/app.json (web.site) and env.
import type { Metadata, MetadataRoute } from "next";
import { webConfig } from "./config";
import type { Lang, Translate } from "./i18n";

export const siteConfig = webConfig.site;

/** The public origin: KEKAL_SITE_URL, else the config url. Trailing slashes dropped; must be http(s). */
export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  const raw = (env.KEKAL_SITE_URL ?? "").trim() || siteConfig.url;
  const url = new URL(raw.replace(/\/+$/, ""));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`site url must be http(s): ${raw}`);
  return url;
}

/** Every crawler may read pages but not the API; link-preview bots get their own group with the same rule. */
export function robotsFile(env: Record<string, string | undefined> = process.env): MetadataRoute.Robots {
  const disallow = [...siteConfig.disallow];
  return {
    rules: [
      { userAgent: [...siteConfig.previewBots], allow: "/", disallow },
      { userAgent: "*", allow: "/", disallow },
    ],
    host: siteUrl(env).origin,
  };
}

const ogLocale: Record<Lang, string> = { en: "en_US", ms: "ms_MY" };

/** Title, description and the Open Graph / Twitter fields. The image itself is app/opengraph-image.png. */
export function pageMetadata(t: Translate, lang: Lang, env: Record<string, string | undefined> = process.env): Metadata {
  const title = t("meta.title");
  const description = t("meta.description");
  return {
    metadataBase: siteUrl(env),
    title,
    description,
    openGraph: {
      type: "website",
      siteName: t("app.name"),
      title,
      description,
      locale: ogLocale[lang],
      alternateLocale: Object.entries(ogLocale)
        .filter(([l]) => l !== lang)
        .map(([, v]) => v),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
