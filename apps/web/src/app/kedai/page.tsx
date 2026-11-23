import type { Metadata } from "next";
import Link from "next/link";
import { SiteFrame } from "@/components/SiteFrame";
import { ShopBoard } from "@/components/kedai/ShopBoard";
import { runtimeCluster } from "@/lib/config";
import { fill, translator, type MessageKey } from "@/lib/i18n";
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
          <p className="note">
            {fill(t("kedai.devnet"), { network: t(`cluster.${runtimeCluster().name}` as MessageKey) })} <Link href="/demo">{t("wallet.tryDemo")}</Link>
          </p>
        </section>
        <ShopBoard lang={lang} settings={boardSettings()} />
      </main>
    </SiteFrame>
  );
}
