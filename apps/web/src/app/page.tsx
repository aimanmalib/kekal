import type { Metadata } from "next";
import { SiteFrame } from "@/components/SiteFrame";
import { WarrantyCard } from "@/components/WarrantyCard";
import { sampleReserve, webConfig } from "@/lib/config";
import { translator, type MessageKey } from "@/lib/i18n";
import { localeMetadata } from "@/lib/page-metadata";
import { requestLang } from "@/lib/request-lang";

const rules: MessageKey[] = ["home.rule.silent", "home.rule.gone", "home.rule.expired"];

// Listing the card here keeps its locale alt text; see src/lib/page-metadata.ts.
export async function generateMetadata(): Promise<Metadata> {
  return localeMetadata();
}

export default async function Home() {
  const lang = await requestLang();
  const t = translator(lang);
  return (
    <SiteFrame lang={lang} t={t}>
      <main className="home">
        <section className="intro">
          <h1>{t("home.title")}</h1>
          <p className="lede">{t("home.lede")}</p>
          <ul className="rules">
            {rules.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </section>
        <WarrantyCard
          t={t}
          product={t("card.sample.product")}
          reserve={sampleReserve()}
          currency={webConfig.currency}
          expires={t("card.sample.expires")}
          status={t("status.claim.paidOrphan")}
          stamp={t("stamp.paid")}
          note={t("card.sample.note")}
        />
      </main>
    </SiteFrame>
  );
}
