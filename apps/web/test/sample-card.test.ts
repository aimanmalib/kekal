// The printed sample card on the home page: the A6 layout of the PDF and PNG card, its QR code pointing at the live demo
// (or the site while the program is not deployed), every line inside the card frame.
import { describe, expect, it } from "vitest";
import app from "../../../config/app.json";
import en from "../../../locales/en.json";
import ms from "../../../locales/ms.json";
import { qrMatrix } from "../src/lib/shop/card";
import { pdfMeasure } from "../src/lib/shop/card-pdf";
import { sampleCard } from "../src/lib/shop/sample-card";

const { card } = app.web.shopBoard;

describe("sample printed card", () => {
  it("is the configured A6 page with the card's fields in each language", async () => {
    for (const [lang, dict] of [["en", en], ["ms", ms]] as const) {
      const c = await sampleCard(lang, "25.00", true);
      expect([c.width, c.height]).toEqual([card.pdfWidth, card.pdfHeight]);
      const texts = c.ops.flatMap((op) => (op.t === "text" ? [op.text] : []));
      expect(texts, lang).toEqual(expect.arrayContaining([dict["card.title"], dict["card.sample.product"], dict["card.sample.serial"], `25.00 ${app.web.currency}`]));
      expect(texts.at(-1), lang).toContain(dict["card.sample.id"]);
    }
  });
  it("points its QR code at the live demo once deployed, at the site before", async () => {
    const qr = (c: Awaited<ReturnType<typeof sampleCard>>) => c.ops.find((op) => op.t === "qr");
    const site = new URL(app.web.site.url);
    expect(qr(await sampleCard("en", "25.00", true))).toMatchObject({ dark: qrMatrix(new URL("/demo", site).href).dark });
    expect(qr(await sampleCard("en", "25.00", false))).toMatchObject({ dark: qrMatrix(site.href).dark });
  });
  it("keeps every line inside the inner frame, measured with the PDF fonts", async () => {
    const measure = await pdfMeasure();
    for (const lang of ["en", "ms"] as const) {
      const c = await sampleCard(lang, "25.00", true);
      for (const op of c.ops) {
        if (op.t !== "text") continue;
        expect(op.x + measure(op.text, op.font, op.size), `${lang} ${op.text}`).toBeLessThanOrEqual(c.width - 18);
      }
    }
  });
});
