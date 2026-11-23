// The PNG card, drawn in the browser on a canvas with the page's own fonts (the card key never leaves the browser).
import { cardOps, type CardFont, type CardPage } from "./card";
import type { CardPalette } from "./card-pdf";

const FAMILY: Record<CardFont, string> = {
  display: "italic 400 {size}px var-display",
  ui: "400 {size}px var-ui",
  uiBold: "600 {size}px var-ui",
  mono: "400 {size}px var-mono",
};

/** CSS font stacks of the page (DESIGN tokens --font-display / --font-ui / --font-mono). */
export function pageFonts(style: CSSStyleDeclaration): Record<string, string> {
  return {
    "var-display": style.getPropertyValue("--font-display").trim() || "serif",
    "var-ui": style.getPropertyValue("--font-ui").trim() || "sans-serif",
    "var-mono": style.getPropertyValue("--font-mono").trim() || "monospace",
  };
}

export async function cardPng(
  page: CardPage,
  qr: { size: number; dark: boolean[]; margin: number },
  size: { pdfWidth: number; pdfHeight: number; pngWidth: number; pngHeight: number },
  palette: CardPalette,
  stacks: Record<string, string>,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size.pngWidth;
  canvas.height = size.pngHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  const font = (f: CardFont, s: number) =>
    FAMILY[f].replace("{size}", String(s)).replace(/var-(display|ui|mono)/, (k) => stacks[k] ?? "sans-serif");
  // Text is set at its final pixel size (not drawn small and scaled), so letters keep their real spacing.
  const k = size.pngWidth / size.pdfWidth;
  const measure = (text: string, f: CardFont, s: number) => {
    ctx.font = font(f, s * k);
    return ctx.measureText(text).width / k;
  };
  ctx.scale(k, size.pngHeight / size.pdfHeight);
  for (const op of cardOps(page, qr, size.pdfWidth, size.pdfHeight, measure)) {
    if (op.t === "rect") {
      if (op.fill) {
        ctx.fillStyle = palette[op.fill];
        ctx.fillRect(op.x, op.y, op.w, op.h);
      }
      if (op.stroke) {
        ctx.strokeStyle = palette[op.stroke];
        ctx.lineWidth = op.lw ?? 1;
        ctx.strokeRect(op.x, op.y, op.w, op.h);
      }
    } else if (op.t === "path") {
      ctx.save();
      ctx.translate(op.x, op.y);
      ctx.strokeStyle = palette[op.stroke];
      ctx.lineWidth = op.lw;
      ctx.stroke(new Path2D(op.d));
      ctx.restore();
    } else if (op.t === "text") {
      ctx.save();
      ctx.scale(1 / k, 1 / k);
      ctx.font = font(op.font, op.size * k);
      ctx.fillStyle = palette[op.color];
      ctx.fillText(op.text, op.x * k, op.y * k);
      ctx.restore();
    } else {
      ctx.fillStyle = palette[op.color];
      for (let r = 0; r < op.size; r++) {
        for (let k = 0; k < op.size; k++) if (op.dark[r * op.size + k]) ctx.fillRect(op.x + k * op.cell, op.y + r * op.cell, op.cell + 0.02, op.cell + 0.02);
      }
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no png"))), "image/png"));
}
