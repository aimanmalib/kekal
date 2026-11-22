import { cookies, headers } from "next/headers";
import { webConfig } from "./config";
import { pickLang, type Lang } from "./i18n";

export async function requestLang(): Promise<Lang> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return pickLang(c.get(webConfig.locales.cookie)?.value, h.get("accept-language"));
}
