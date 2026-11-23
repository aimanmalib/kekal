"use client";

import { useMemo, useState } from "react";
import { fill, translator, type Lang, type MessageKey, type Translate } from "@/lib/i18n";
import { qrMatrix } from "@/lib/shop/card";
import { CARD_LANGS, cardPage, type CardFacts } from "@/lib/shop/card-content";
import { cardPdf, type CardPalette } from "@/lib/shop/card-pdf";
import { cardPng, pageFonts } from "@/lib/shop/card-png";

export interface CardSize {
  pdfWidth: number;
  pdfHeight: number;
  pngWidth: number;
  pngHeight: number;
  qrMargin: number;
}

interface Props {
  t: Translate;
  facts: CardFacts;
  size: CardSize;
  /** False when the terms text could not be kept: the card still works, its page shows no promise text. */
  termsKept: boolean;
}

function palette(): CardPalette {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return { paper: v("--paper"), ink: v("--ink"), inkSoft: v("--ink-soft"), rule: v("--rule"), copper: v("--copper") };
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The card just issued: its link, a QR preview and the PNG / PDF files. The card key exists only in this tab. */
export function IssuedCard({ t, facts, size, termsKept }: Props) {
  const qr = useMemo(() => ({ ...qrMatrix(facts.link), margin: size.qrMargin }), [facts.link, size.qrMargin]);
  const [failed, setFailed] = useState(false);
  const base = fill(t("kedai.card.file"), { id: facts.warrantyId });

  async function png(lang: Lang) {
    setFailed(false);
    try {
      await document.fonts.ready;
      save(await cardPng(cardPage(facts, lang), qr, size, palette(), pageFonts(getComputedStyle(document.documentElement))), `${base}-${lang}.png`);
    } catch {
      setFailed(true);
    }
  }

  async function pdf() {
    setFailed(false);
    try {
      const bytes = await cardPdf(
        CARD_LANGS.map((l) => cardPage(facts, l)),
        qr,
        { width: size.pdfWidth, height: size.pdfHeight },
        palette(),
        t("card.title"),
      );
      save(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${base}.pdf`);
    } catch {
      setFailed(true);
    }
  }

  const cells = qr.size + 2 * qr.margin;
  return (
    <div className="issued" aria-live="polite">
      <h3>{fill(t("kedai.card.heading"), { id: facts.warrantyId })}</h3>
      <svg className="issued-qr" viewBox={`0 0 ${cells} ${cells}`} role="img" aria-label={t("kedai.card.qrAlt")} shapeRendering="crispEdges">
        <rect width={cells} height={cells} className="qr-paper" />
        {qr.dark.map((on, i) =>
          on ? <rect key={i} x={(i % qr.size) + qr.margin} y={Math.floor(i / qr.size) + qr.margin} width={1} height={1} className="qr-ink" /> : null,
        )}
      </svg>
      <p className="warn">{t("kedai.card.keyWarning")}</p>
      <div className="button-row">
        <button type="button" className="button" onClick={() => void pdf()}>
          {t("kedai.card.pdf")}
        </button>
        {CARD_LANGS.map((l) => (
          <button key={l} type="button" className="button button-quiet" onClick={() => void png(l)}>
            {fill(t("kedai.card.png"), { lang: translator(l)(`lang.${l}` as MessageKey) })}
          </button>
        ))}
      </div>
      <label className="saved-card">
        <span className="note">{t("kedai.card.link")}</span>
        <input className="mono" readOnly value={facts.link} onFocus={(e) => e.currentTarget.select()} />
      </label>
      {!termsKept ? <p className="warn">{t("kedai.card.termsNotKept")}</p> : null}
      {failed ? <p className="warn" role="alert">{t("kedai.card.fileFailed")}</p> : null}
    </div>
  );
}
