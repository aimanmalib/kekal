import type { Metadata } from "next";
import { SiteFrame } from "@/components/SiteFrame";
import { ShopBoard } from "@/components/kedai/ShopBoard";
import { ShopNetworkNote } from "@/components/kedai/ShopNetworkNote";
import { runtimeCluster } from "@/lib/config";
import { translator } from "@/lib/i18n";
import { localeMetadata } from "@/lib/page-metadata";
import { requestLang } from "@/lib/request-lang";
import { boardSettings } from "@/lib/shop/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await requestLang());
  return { ...(await localeMetadata()), title: `${t("kedai.title")} · ${t("app.name")}` };
}

export default async function ShopPage() {
  const lang = await requestLang();
  const t = translator(lang);
  return (
    <SiteFrame lang={lang} t={t}>
      <main className="board-page">
        <section>
          <h1>{t("kedai.title")}</h1>
          <p className="lede">{t("kedai.lede")}</p>
          <ShopNetworkNote t={t} cluster={runtimeCluster()} />
        </section>
        <ShopBoard lang={lang} settings={boardSettings()} />
      </main>
    </SiteFrame>
  );
}
