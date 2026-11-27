// Reads a language from the URL query (?lang=ms). Safe for the proxy bundle: config only, no dictionaries.
import { webConfig } from "./web-config";

/** Request header the proxy uses to pass a query-chosen language to server components. */
export const LANG_HEADER = "x-kekal-lang";

/** The supported language named by the query parameter, or null when absent or unknown. */
export function queryLang(params: URLSearchParams): string | null {
  const v = params.get(webConfig.locales.queryParam)?.trim().toLowerCase();
  return v && (webConfig.locales.supported as string[]).includes(v) ? v : null;
}

/** URL path + query without the language parameter (used after the reader switches language). */
export function withoutLangParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(webConfig.locales.queryParam);
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}
