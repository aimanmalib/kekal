import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFrame } from "@/components/SiteFrame";
import { ShopRecord, ShopRecordMissing } from "@/components/kedai/ShopRecord";
import { clusterSettings } from "@kekal/server";
import { runtimeCluster } from "@/lib/config";
import { translator } from "@/lib/i18n";
import { localeMetadata } from "@/lib/page-metadata";
import { requestLang } from "@/lib/request-lang";
import { publicShopReader, shopPageSettings } from "@/lib/shop/public";
import { readShopBoard } from "@/lib/shop/read";
import { siteUrl } from "@/lib/site";
import { parseAddress } from "@/lib/warranty/read";

export const dynamic = "force-dynamic";

const readPublicShop = publicShopReader((owner) => readShopBoard(owner), shopPageSettings);

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await requestLang());
  return { ...(await localeMetadata()), title: `${t("shopPage.metaTitle")} · ${t("app.name")}` };
}

export default async function PublicShopPage({ params }: { params: Promise<{ owner: string }> }) {
  const raw = (await params).owner;
  const owner = parseAddress(raw);
  const cluster = runtimeCluster();
  if (!owner || !cluster.deployed) notFound();
  const lang = await requestLang();
  const t = translator(lang);
  let view;
  try {
    view = await readPublicShop(owner, Date.now());
  } catch {
    return (
      <SiteFrame lang={lang} t={t}>
        <ShopRecordMissing reason="network" t={t} />
      </SiteFrame>
    );
  }
  if (!view) notFound();
  const template = clusterSettings(cluster.name).explorerAddress;
  const now = view.chainNow ?? Math.floor(Date.now() / 1000);
  return (
    <SiteFrame lang={lang} t={t}>
      <ShopRecord
        view={view}
        lang={lang}
        t={t}
        now={now}
        addressUrl={(a) => template.replace("{address}", a)}
        pageUrl={new URL(`/kedai/${view.owner}`, siteUrl()).toString()}
      />
    </SiteFrame>
  );
}
