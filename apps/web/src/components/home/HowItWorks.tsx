import type { StaticImageData } from "next/image";
import type { Lang, MessageKey, Translate } from "@/lib/i18n";
import shopEnAvif from "@/media/how/shop-en.avif";
import shopEnWebp from "@/media/how/shop-en.webp";
import shopMsAvif from "@/media/how/shop-ms.avif";
import shopMsWebp from "@/media/how/shop-ms.webp";
import cardEnAvif from "@/media/how/card-en.avif";
import cardEnWebp from "@/media/how/card-en.webp";
import cardMsAvif from "@/media/how/card-ms.avif";
import cardMsWebp from "@/media/how/card-ms.webp";
import paidEnAvif from "@/media/how/paid-en.avif";
import paidEnWebp from "@/media/how/paid-en.webp";
import paidMsAvif from "@/media/how/paid-ms.avif";
import paidMsWebp from "@/media/how/paid-ms.webp";

type Asset = StaticImageData | string;
interface Shot {
  avif: Asset;
  webp: Asset;
}

/** Crops of the WebKit iPhone 13 screenshots from the e2e run (scripts/home-shots.py): one phone screen, 390 x 780 CSS px. */
const SHOTS: Record<"shop" | "card" | "paid", Record<Lang, Shot>> = {
  shop: { en: { avif: shopEnAvif, webp: shopEnWebp }, ms: { avif: shopMsAvif, webp: shopMsWebp } },
  card: { en: { avif: cardEnAvif, webp: cardEnWebp }, ms: { avif: cardMsAvif, webp: cardMsWebp } },
  paid: { en: { avif: paidEnAvif, webp: paidEnWebp }, ms: { avif: paidMsAvif, webp: paidMsWebp } },
};
const STEPS = ["shop", "card", "paid"] as const;
const SHOT_WIDTH = 390;
const SHOT_HEIGHT = 780;

// Next.js imports an image as { src, width, height }; plain Vite (the unit tests) as a URL string.
const url = (a: Asset): string => (typeof a === "string" ? a : a.src);

/** Plain <picture>, not next/image: the files are already sized and encoded, so no optimiser has to run in the container.
 * Three steps, each with a real screen from the browser tests in the page's language. A sequence, so an ordered list. */
export function HowItWorks({ t, lang }: { t: Translate; lang: Lang }) {
  return (
    <section className="home-section how" aria-labelledby="how-title">
      <h2 id="how-title">{t("home.how.title")}</h2>
      <ol className="how-steps">
        {STEPS.map((step) => {
          const shot = SHOTS[step][lang];
          return (
            <li key={step}>
              <picture className="how-shot">
                <source type="image/avif" srcSet={url(shot.avif)} />
                <img
                  src={url(shot.webp)}
                  width={SHOT_WIDTH}
                  height={SHOT_HEIGHT}
                  alt={t(`home.how.${step}.alt` as MessageKey)}
                  loading="eager"
                  decoding="async"
                />
              </picture>
              <h3>{t(`home.how.${step}.title` as MessageKey)}</h3>
              <p>{t(`home.how.${step}.body` as MessageKey)}</p>
            </li>
          );
        })}
      </ol>
      <p className="how-note">{t("home.how.note")}</p>
    </section>
  );
}
