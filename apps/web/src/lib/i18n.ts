// UI text lives only in locales/*.json. This module picks a language and looks keys up.
import en from "../../../../locales/en.json";
import ms from "../../../../locales/ms.json";
import { webConfig } from "./config";

export const dictionaries = { en, ms } as const;
export type Lang = keyof typeof dictionaries;
export type MessageKey = keyof typeof en;

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (webConfig.locales.supported as string[]).includes(v) && v in dictionaries;
}

/** Saved choice wins; otherwise the first supported language in Accept-Language; otherwise the fallback. */
export function pickLang(saved: string | undefined, acceptLanguage: string | null | undefined): Lang {
  if (isLang(saved)) return saved;
  const prefs = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { base: tag.toLowerCase().split("-")[0] ?? "", q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((p) => p.base && !Number.isNaN(p.q) && p.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const p of prefs) if (isLang(p.base)) return p.base;
  return webConfig.locales.fallback as Lang;
}

export type Translate = (key: MessageKey) => string;

export function translator(lang: Lang): Translate {
  const dict: Record<string, string> = dictionaries[lang];
  return (key) => dict[key] ?? en[key];
}
