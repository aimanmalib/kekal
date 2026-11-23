import type { Metadata } from "next";
import { SiteFrame } from "@/components/SiteFrame";
import { ArbiterBoard } from "@/components/timbang/ArbiterBoard";
import { translator } from "@/lib/i18n";
import { localeMetadata } from "@/lib/page-metadata";
import { requestLang } from "@/lib/request-lang";
import { arbiterSettings } from "@/lib/shop/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await requestLang());
  return { ...(await localeMetadata()), title: `${t("timbang.title")} · ${t("app.name")}` };
}

export default async function ArbiterPage() {
  const lang = await requestLang();
  const t = translator(lang);
  return (
    <SiteFrame lang={lang} t={t}>
      <main className="board-page">
        <section>
          <h1>{t("timbang.title")}</h1>
          <p className="lede">{t("timbang.lede")}</p>
        </section>
        <ArbiterBoard lang={lang} settings={arbiterSettings()} />
      </main>
    </SiteFrame>
  );
}
