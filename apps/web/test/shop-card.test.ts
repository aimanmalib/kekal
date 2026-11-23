// The printed card: QR matrix, line wrapping, layout bounds, and the A6 PDF generated in the test (EN + BM pages).
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import webConfig from "../../../config/app.json";
import { cardOps, qrMatrix, wrap, type Measure } from "../src/lib/shop/card";
import { CARD_LANGS, cardPage, type CardFacts } from "../src/lib/shop/card-content";
import { cardPdf, printable } from "../src/lib/shop/card-pdf";

const card = webConfig.web.shopBoard.card;
const palette = { paper: "#faf8f1", ink: "#143829", inkSoft: "#4a5c52", rule: "#c8c1a9", copper: "#a3521c" };
const facts: CardFacts = {
  link: `https://example.test/w/${"1".repeat(44)}#k=${"2".repeat(44)}`,
  host: "example.test",
  warrantyId: "7",
  product: "Water heater, installed",
  serial: "SN-0001",
  reserve: "25000000",
  decimals: 6,
  currency: "kUSD",
  expiresAt: 1_800_000_000,
  promise: { en: "We fix our installation work. ".repeat(30), ms: "Kami membaiki kerja pemasangan kami. ".repeat(30) },
};
const mono: Measure = (text, _font, size) => text.length * size * 0.55;

describe("card layout", () => {
  it("encodes the card link as a square QR matrix", () => {
    const qr = qrMatrix(facts.link);
    expect(qr.size).toBeGreaterThan(20);
    expect(qr.dark).toHaveLength(qr.size * qr.size);
  });

  it("wraps on words, cuts words wider than the line and ends a cut text with an ellipsis", () => {
    const m = (s: string) => s.length;
    expect(wrap("aa bb cc", 5, m)).toEqual(["aa bb", "cc"]);
    expect(wrap("abcdefgh", 3, m)).toEqual(["abc", "def", "gh"]);
    expect(wrap("aa bb cc dd", 5, m, 1)).toEqual(["aa b…"]);
  });

  it("keeps every mark inside the page and the long promise above the footer", () => {
    const qr = { ...qrMatrix(facts.link), margin: card.qrMargin };
    for (const lang of CARD_LANGS) {
      const ops = cardOps(cardPage(facts, lang), qr, card.pdfWidth, card.pdfHeight, mono);
      for (const op of ops) {
        expect(op.x).toBeGreaterThanOrEqual(0);
        expect(op.y).toBeLessThanOrEqual(card.pdfHeight);
        if (op.t === "text") expect(op.x + mono(op.text, op.font, op.size)).toBeLessThanOrEqual(card.pdfWidth);
      }
      const texts = ops.filter((o) => o.t === "text");
      const footer = texts.at(-1)!;
      expect(texts.slice(0, -1).every((o) => o.y < footer.y)).toBe(true);
      expect(texts.some((o) => o.text.endsWith("…"))).toBe(true);
    }
  });
});

describe("card PDF", () => {
  it("is an A6 file with one English and one Malay page", async () => {
    const qr = { ...qrMatrix(facts.link), margin: card.qrMargin };
    const bytes = await cardPdf(CARD_LANGS.map((l) => cardPage(facts, l)), qr, { width: card.pdfWidth, height: card.pdfHeight }, palette, "Warranty card");
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    for (const p of doc.getPages()) {
      expect(p.getWidth()).toBeCloseTo(card.pdfWidth, 1);
      expect(p.getHeight()).toBeCloseTo(card.pdfHeight, 1);
    }
    expect(doc.getTitle()).toBe("Warranty card");
  });

  it("replaces characters the standard fonts cannot print instead of failing", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(printable("Pemanas air 热水器", font)).toBe("Pemanas air ???");
    const qr = { ...qrMatrix(facts.link), margin: card.qrMargin };
    const bytes = await cardPdf([cardPage({ ...facts, product: "热水器" }, "ms")], qr, { width: card.pdfWidth, height: card.pdfHeight }, palette, "Kad");
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
