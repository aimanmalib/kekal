// The A6 PDF card: one page per language. Standard PDF fonts (no font files to ship); characters they cannot print are
// replaced, and the full text stays on the warranty page.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { cardOps, type CardColor, type CardFont, type CardPage } from "./card";

export type CardPalette = Record<CardColor, string>;

function color(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new RangeError(`not a #rrggbb colour: ${hex}`);
  return rgb(parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255);
}

/** Replaces every character the font cannot encode with "?". */
export function printable(text: string, font: PDFFont): string {
  const set = new Set(font.getCharacterSet());
  return Array.from(text, (ch) => (set.has(ch.codePointAt(0)!) ? ch : "?")).join("");
}

function draw(page: PDFPage, ops: ReturnType<typeof cardOps>, fonts: Record<CardFont, PDFFont>, palette: CardPalette) {
  const H = page.getHeight();
  for (const op of ops) {
    if (op.t === "rect") {
      page.drawRectangle({
        x: op.x,
        y: H - op.y - op.h,
        width: op.w,
        height: op.h,
        color: op.fill ? color(palette[op.fill]) : undefined,
        borderColor: op.stroke ? color(palette[op.stroke]) : undefined,
        borderWidth: op.stroke ? (op.lw ?? 1) : 0,
      });
    } else if (op.t === "path") {
      page.drawSvgPath(op.d, { x: op.x, y: H - op.y, borderColor: color(palette[op.stroke]), borderWidth: op.lw });
    } else if (op.t === "text") {
      page.drawText(op.text, { x: op.x, y: H - op.y, size: op.size, font: fonts[op.font], color: color(palette[op.color]) });
    } else {
      const c = color(palette[op.color]);
      for (let r = 0; r < op.size; r++) {
        for (let k = 0; k < op.size; k++) {
          if (op.dark[r * op.size + k]) page.drawRectangle({ x: op.x + k * op.cell, y: H - op.y - (r + 1) * op.cell, width: op.cell, height: op.cell, color: c });
        }
      }
    }
  }
}

export async function cardPdf(
  pages: CardPage[],
  qr: { size: number; dark: boolean[]; margin: number },
  size: { width: number; height: number },
  palette: CardPalette,
  title: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Kekal");
  doc.setProducer("Kekal");
  const fonts: Record<CardFont, PDFFont> = {
    display: await doc.embedFont(StandardFonts.TimesRomanItalic),
    ui: await doc.embedFont(StandardFonts.Helvetica),
    uiBold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const measure = (text: string, font: CardFont, sz: number) => fonts[font].widthOfTextAtSize(printable(text, fonts[font]), sz);
  for (const p of pages) {
    const page = doc.addPage([size.width, size.height]);
    const ops = cardOps(p, qr, size.width, size.height, measure).map((op) =>
      op.t === "text" ? { ...op, text: printable(op.text, fonts[op.font]) } : op,
    );
    draw(page, ops, fonts, palette);
  }
  return doc.save();
}
