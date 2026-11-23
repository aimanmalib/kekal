// The words on a printed card, one page per language (EN then BM). Labels come from the locale files.
import { fill, translator, type Lang } from "../i18n";
import { formatDate, formatUnits } from "../warranty/format";
import type { CardPage } from "./card";

export interface CardFacts {
  link: string;
  host: string;
  warrantyId: string;
  product: string;
  serial: string;
  /** Base units. */
  reserve: string;
  decimals: number;
  currency: string;
  expiresAt: number;
  promise: { en: string; ms: string };
}

export const CARD_LANGS: Lang[] = ["en", "ms"];

export function cardPage(f: CardFacts, lang: Lang): CardPage {
  const t = translator(lang);
  return {
    title: t("card.title"),
    fields: [
      { label: t("card.product"), value: f.product },
      { label: t("card.serial"), value: f.serial },
      { label: t("card.reserve"), value: `${formatUnits(f.reserve, f.decimals)} ${f.currency}`, mono: true },
      { label: t("card.expires"), value: formatDate(f.expiresAt, lang) },
    ],
    caption: t("card.print.scan"),
    promise: f.promise[lang === "ms" ? "ms" : "en"],
    footer: fill(t("card.print.footer"), { host: f.host, id: f.warrantyId }),
  };
}
