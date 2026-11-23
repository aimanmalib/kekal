import type { Metadata } from "next";
import { SiteFrame } from "@/components/SiteFrame";
import { CheckForm } from "@/components/warranty/CheckForm";
import { translator } from "@/lib/i18n";
import { localeMetadata } from "@/lib/page-metadata";
import { requestLang } from "@/lib/request-lang";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await requestLang());
  return { ...(await localeMetadata()), title: `${t("check.title")} · ${t("app.name")}` };
}

export default async function CheckPage() {
  const lang = await requestLang();
  const t = translator(lang);
  return (
    <SiteFrame lang={lang} t={t}>
      <main className="check-page">
        <h1>{t("check.title")}</h1>
        <p className="lede">{t("check.lede")}</p>
        <CheckForm lang={lang} />
      </main>
    </SiteFrame>
  );
}
