import type { Metadata } from "next";
import { SiteFrame } from "@/components/SiteFrame";
import { ExamplesView } from "@/components/demo/ExamplesView";
import { runtimeCluster, webConfig } from "@/lib/config";
import { siteExamples } from "@/lib/demo/site-examples";
import { translator, type MessageKey } from "@/lib/i18n";
import { localeMetadata } from "@/lib/page-metadata";
import { requestLang } from "@/lib/request-lang";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await requestLang());
  const title = siteExamples(runtimeCluster().name) ? t("examples.title") : t("examples.titlePending");
  return { ...(await localeMetadata()), title: `${title} · ${t("app.name")}` };
}

export default async function ExamplesPage() {
  const lang = await requestLang();
  const t = translator(lang);
  const cluster = runtimeCluster();
  return (
    <SiteFrame lang={lang} t={t}>
      <main className="demo">
        <ExamplesView
          t={t}
          examples={siteExamples(cluster.name)}
          deployed={cluster.deployed}
          network={t(`cluster.${cluster.name}` as MessageKey)}
          order={webConfig.examples.paths}
        />
      </main>
    </SiteFrame>
  );
}
