// The printed warranty card (PRD 4.5, DESIGN "The card"): one layout, drawn twice, into the A6 PDF and the PNG.
// Pure: positions come from a text measurer the renderer supplies, so the PDF and the canvas wrap lines with their own
// fonts. Coordinates are points from the top-left corner; y of a text op is its baseline.
import QRCode from "qrcode";
import { guillochePaths } from "../guilloche";

export type CardFont = "display" | "ui" | "uiBold" | "mono";
export type CardColor = "paper" | "ink" | "inkSoft" | "rule" | "copper";
export type Measure = (text: string, font: CardFont, size: number) => number;

export type CardOp =
  | { t: "rect"; x: number; y: number; w: number; h: number; fill?: CardColor; stroke?: CardColor; lw?: number }
  | { t: "path"; x: number; y: number; d: string; stroke: CardColor; lw: number }
  | { t: "text"; x: number; y: number; text: string; font: CardFont; size: number; color: CardColor }
  | { t: "qr"; x: number; y: number; cell: number; size: number; dark: boolean[]; color: CardColor };

export interface CardPage {
  title: string;
  fields: { label: string; value: string; mono?: boolean }[];
  caption: string;
  promise: string;
  footer: string;
}

/** Dark modules of the QR code for `text` (error correction M), row by row. */
export function qrMatrix(text: string): { size: number; dark: boolean[] } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  return { size, dark: Array.from(data, (v) => v === 1) };
}

/** Greedy word wrap; a word longer than the width is cut. At most `maxLines`, the last one ending in an ellipsis if cut. */
export function wrap(text: string, width: number, measure: (s: string) => number, maxLines = Infinity): string[] {
  const lines: string[] = [];
  let line = "";
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  for (let word of words) {
    while (measure(word) > width && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && measure(word.slice(0, cut)) > width) cut--;
      if (line) lines.push(line);
      lines.push(word.slice(0, cut));
      line = "";
      word = word.slice(cut);
    }
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last && measure(`${last}…`) > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

const M = 14; // outer margin
const PAD = 22; // text inset from the page edge

/** Lays out one card page of `width` × `height` points around the QR code of `link`. */
export function cardOps(page: CardPage, qr: { size: number; dark: boolean[]; margin: number }, width: number, height: number, measure: Measure): CardOp[] {
  const ops: CardOp[] = [
    { t: "rect", x: 0, y: 0, w: width, h: height, fill: "paper" },
    { t: "rect", x: M, y: M, w: width - 2 * M, h: height - 2 * M, stroke: "ink", lw: 1.2 },
    { t: "rect", x: M + 4, y: M + 4, w: width - 2 * M - 8, h: height - 2 * M - 8, stroke: "rule", lw: 0.5 },
  ];
  const bandW = width - 2 * M - 16;
  for (const d of guillochePaths(bandW, 26, 9, 6)) ops.push({ t: "path", x: M + 8, y: M + 9, d, stroke: "rule", lw: 0.35 });
  const textW = width - 2 * PAD;
  let y = M + 9 + 26 + 22;
  ops.push({ t: "text", x: PAD, y, text: page.title, font: "display", size: 17, color: "ink" });
  y += 16;
  for (const f of page.fields) {
    ops.push({ t: "text", x: PAD, y, text: f.label, font: "ui", size: 6.5, color: "inkSoft" });
    y += 10;
    const font: CardFont = f.mono ? "mono" : "uiBold";
    const [value = ""] = wrap(f.value, textW, (s) => measure(s, font, 9), 1);
    ops.push({ t: "text", x: PAD, y, text: value, font, size: 9, color: "ink" });
    y += 13;
  }
  const qrSide = 112;
  const cells = qr.size + 2 * qr.margin;
  const cell = qrSide / cells;
  const qx = (width - qrSide) / 2;
  y += 2;
  ops.push({ t: "rect", x: qx, y, w: qrSide, h: qrSide, fill: "paper" });
  ops.push({ t: "qr", x: qx + qr.margin * cell, y: y + qr.margin * cell, cell, size: qr.size, dark: qr.dark, color: "ink" });
  y += qrSide + 11;
  for (const line of wrap(page.caption, textW, (s) => measure(s, "uiBold", 7), 2)) {
    ops.push({ t: "text", x: (width - measure(line, "uiBold", 7)) / 2, y, text: line, font: "uiBold", size: 7, color: "ink" });
    y += 9;
  }
  y += 3;
  const footerY = height - M - 10;
  const room = Math.max(0, Math.floor((footerY - 10 - y) / 8));
  for (const line of wrap(page.promise, textW, (s) => measure(s, "ui", 6.2), room)) {
    ops.push({ t: "text", x: PAD, y, text: line, font: "ui", size: 6.2, color: "inkSoft" });
    y += 8;
  }
  ops.push({ t: "text", x: PAD, y: footerY, text: page.footer, font: "mono", size: 5.8, color: "inkSoft" });
  return ops;
}
