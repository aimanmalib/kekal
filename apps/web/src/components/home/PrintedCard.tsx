import type { CardColor, CardFont } from "@/lib/shop/card";
import type { SampleCard } from "@/lib/shop/sample-card";

const FILL: Record<CardColor, string> = { paper: "pc-paper", ink: "pc-ink", inkSoft: "pc-ink-soft", rule: "pc-rule", copper: "pc-copper" };
const FONT: Record<CardFont, string> = { display: "pc-display", ui: "pc-ui", uiBold: "pc-ui-bold", mono: "pc-mono" };
const round = (n: number) => Math.round(n * 100) / 100;

/** The printed A6 card as SVG, drawn from the same operations as the PDF and the PNG card; colours and fonts are CSS
 * classes on the page tokens (home.css), so it never drifts from the rest of the site. */
export function PrintedCard({ card, label }: { card: SampleCard; label: string }) {
  return (
    <svg className="printed-card" viewBox={`0 0 ${card.width} ${card.height}`} role="img" aria-label={label}>
      {card.ops.map((op, i) => {
        if (op.t === "rect") {
          return (
            <rect
              key={i}
              x={round(op.x)}
              y={round(op.y)}
              width={round(op.w)}
              height={round(op.h)}
              className={[op.fill ? `${FILL[op.fill]}-f` : "pc-none-f", op.stroke ? `${FILL[op.stroke]}-s` : ""].join(" ").trim()}
              strokeWidth={op.stroke ? (op.lw ?? 1) : undefined}
            />
          );
        }
        if (op.t === "path") {
          return <path key={i} d={op.d} transform={`translate(${round(op.x)} ${round(op.y)})`} className={`pc-none-f ${FILL[op.stroke]}-s`} strokeWidth={op.lw} />;
        }
        if (op.t === "text") {
          return (
            <text key={i} x={round(op.x)} y={round(op.y)} fontSize={op.size} className={`${FONT[op.font]} ${FILL[op.color]}-f`}>
              {op.text}
            </text>
          );
        }
        // One path for the whole QR code: a square per dark module.
        const d: string[] = [];
        op.dark.forEach((on, k) => {
          if (on) d.push(`M${round(op.x + (k % op.size) * op.cell)} ${round(op.y + Math.floor(k / op.size) * op.cell)}h${round(op.cell)}v${round(op.cell)}h-${round(op.cell)}z`);
        });
        return <path key={i} d={d.join("")} className={`${FILL[op.color]}-f`} shapeRendering="crispEdges" />;
      })}
    </svg>
  );
}
