// Server-rendered markup of /w/[pda]: real values on the card, honest terms check, timeline labels, and no
// blockchain words outside the collapsed technical details.
import { ClaimStatus, WarrantyStatus, hashJson } from "@kekal/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WarrantyDetails, WarrantyMissing } from "../src/components/warranty/WarrantyDetails";
import { translator, type Lang } from "../src/lib/i18n";
import { T0, entry, view, warrantyAcc } from "./warranty-fixtures";

const terms = { v: 1, product: { en: "Ceiling fan, installed", ms: "Kipas siling, dipasang" }, promise: { en: "Free fixes.", ms: "Baiki percuma." } };
const termsJson = JSON.stringify(terms);
const render = (lang: Lang, v = view()) =>
  renderToStaticMarkup(<WarrantyDetails view={v} lang={lang} t={translator(lang)} now={T0 + 30} />);

describe("warranty page markup", () => {
  it("shows the product from the terms, the reserve, the estimate and a matching terms check", () => {
    const html = render("en", view({ warranty: warrantyAcc({ termsHash: hashJson(terms) }), terms: { json: termsJson, matches: true } }));
    expect(html).toContain("Ceiling fan, installed");
    expect(html).toContain("25.00");
    expect(html).toContain("(estimate)");
    expect(html).toContain(translator("en")("terms.match"));
    expect(html).not.toContain('class="stamp"');
  });

  it("speaks Malay with the Malay terms text", () => {
    const html = render("ms", view({ terms: { json: termsJson, matches: true } }));
    expect(html).toContain("Kipas siling, dipasang");
    expect(html).toContain("Baiki percuma.");
    expect(html).toContain(translator("ms")("timeline.heading"));
  });

  it("warns when the terms text does not match, and says so when there is none", () => {
    expect(render("en", view({ terms: { json: termsJson, matches: false } }))).toContain(translator("en")("terms.mismatch"));
    expect(render("en")).toContain(translator("en")("terms.missing"));
  });

  it("stamps a paid warranty with the reason it was paid", () => {
    const paid = entry({ events: ["ReservePaid", "ClaimStatusChanged"], paid: { amount: "25000000", claimStatus: ClaimStatus.PaidOrphan } });
    const html = render("en", view({ warranty: warrantyAcc({ status: WarrantyStatus.PaidOut }), timeline: [paid] }));
    expect(html).toContain('class="stamp"');
    expect(html).toContain("Paid: the shop went silent");
    expect(html).toContain(translator("en")("event.ReservePaid"));
    expect(html).not.toContain(translator("en")("event.ClaimStatusChanged"));
  });

  it("keeps blockchain, wallet and token inside the technical details only", () => {
    for (const lang of ["en", "ms"] as const) {
      const html = render(lang);
      const outside = html.replace(/<details[\s\S]*<\/details>/, "");
      expect(outside).not.toMatch(/blockchain|wallet|dompet|token/i);
      expect(html).toMatch(/<details[\s\S]*blockchain/i);
    }
  });

  it("says when the card is not activated yet, and the next deadline", () => {
    const html = render("en");
    expect(html).toContain(translator("en")("warranty.notActivated"));
    expect(html).toContain("The shop must check in by");
  });

  it("shows deadlines on this clock when the chain clock runs behind", () => {
    const due = (skew: number) => /The shop must check in by ([^.]+)\./.exec(render("en", { ...view(), clockSkew: skew }))![1];
    expect(due(0)).not.toBe(due(-3600));
  });

  it("missing pages explain what happened and link to the checker", () => {
    for (const reason of ["bad_address", "not_found", "network"] as const) {
      const html = renderToStaticMarkup(<WarrantyMissing reason={reason} t={translator("en")} />);
      expect(html).toContain(translator("en")(`missing.${reason}.title`));
      expect(html).toContain('href="/semak"');
    }
  });
});
