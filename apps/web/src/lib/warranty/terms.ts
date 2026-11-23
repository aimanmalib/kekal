// Readable fields of a warranty's terms text. Shops write terms as JSON; a field may be a plain string or one string per
// language ({ "en": ..., "ms": ... }). Unknown shapes still show, as the raw text.
import type { Lang } from "../i18n";

export interface TermsText {
  product: string | null;
  promise: string | null;
}

function pick(v: unknown, lang: Lang, fallback: string): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const s = o[lang] ?? o[fallback];
    if (typeof s === "string") return s;
  }
  return null;
}

export function readTerms(json: string | null, lang: Lang, fallback: string): TermsText {
  if (!json) return { product: null, promise: null };
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (typeof o !== "object" || o === null) return { product: null, promise: null };
    return { product: pick(o.product, lang, fallback), promise: pick(o.promise, lang, fallback) };
  } catch {
    return { product: null, promise: null };
  }
}
