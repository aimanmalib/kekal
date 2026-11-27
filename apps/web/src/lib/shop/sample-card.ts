// The sample printed card on the home page: the same A6 layout as the PDF and PNG card (cardOps), laid out on the server
// with the PDF's own text measurer and drawn as SVG. Its QR code opens the live demo, or the site while the program is
// not on the network.
import { fill, translator, type Lang } from "../i18n";
import { webConfig } from "../web-config";
import { siteUrl } from "../site";
import { cardOps, qrMatrix, type CardOp, type CardPage, type Measure } from "./card";
import { pdfMeasure } from "./card-pdf";

export interface SampleCard {
  ops: CardOp[];
  width: number;
  height: number;
}

/** The page fonts run a little wider than the PDF's standard fonts; measuring with this margin keeps every line inside the frame. */
const FONT_MARGIN = 1.06;

let measurer: Promise<Measure> | null = null;

export function sampleCardPage(lang: Lang, reserve: string, currency: string, host: string): CardPage {
  const t = translator(lang);
  return {
    title: t("card.title"),
    fields: [
      { label: t("card.product"), value: t("card.sample.product") },
      { label: t("card.serial"), value: t("card.sample.serial") },
      { label: t("card.reserve"), value: `${reserve} ${currency}`, mono: true },
      { label: t("card.expires"), value: t("card.sample.expires") },
    ],
    caption: t("card.print.scan"),
    promise: t("card.sample.promise"),
    footer: fill(t("card.print.footer"), { host, id: t("card.sample.id") }),
  };
}

export async function sampleCard(lang: Lang, reserve: string, deployed: boolean): Promise<SampleCard> {
  const { card } = webConfig.shopBoard;
  const site = siteUrl();
  const link = deployed ? new URL("/demo", site).href : site.href;
  measurer ??= pdfMeasure();
  const pdf = await measurer;
  const measure: Measure = (text, font, size) => pdf(text, font, size) * FONT_MARGIN;
  const page = sampleCardPage(lang, reserve, webConfig.currency, site.host);
  const ops = cardOps(page, { ...qrMatrix(link), margin: card.qrMargin }, card.pdfWidth, card.pdfHeight, measure);
  return { ops, width: card.pdfWidth, height: card.pdfHeight };
}
