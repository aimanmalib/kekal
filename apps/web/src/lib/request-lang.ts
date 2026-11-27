import { cookies, headers } from "next/headers";
import { webConfig } from "./config";
import { pickLang, type Lang } from "./i18n";
import { LANG_HEADER } from "./lang-query";

/** Language for this request: ?lang= (set by the proxy) wins, then the saved cookie, then Accept-Language. */
export async function requestLang(): Promise<Lang> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return pickLang(h.get(LANG_HEADER) ?? c.get(webConfig.locales.cookie)?.value, h.get("accept-language"));
}
