import type { Metadata } from "next";
import Link from "next/link";
import report from "../../../../../config/examples.json";
import { SiteFrame } from "@/components/SiteFrame";
import { ExamplePaths } from "@/components/demo/ExamplePaths";
import { runtimeCluster, webConfig } from "@/lib/config";
import { readExamples } from "@/lib/demo/examples";
import { translator } from "@/lib/i18n";
import { localeMetadata } from "@/lib/page-metadata";
import { requestLang } from "@/lib/request-lang";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await requestLang());
  return { ...(await localeMetadata()), title: `${t("examples.title")} · ${t("app.name")}` };
}

export default async function ExamplesPage() {
  const lang = await requestLang();
  const t = translator(lang);
  const examples = readExamples(report, runtimeCluster().name, webConfig.examples.paths);
  return (
    <SiteFrame lang={lang} t={t}>
      <main className="demo">
        <section className="demo-head">
          <h1>{t("examples.title")}</h1>
          <p className="lede">{t("examples.lede")}</p>
          <p className="note">
            <Link href="/demo">{t("examples.demoLink")}</Link>
          </p>
        </section>
        {examples ? <ExamplePaths examples={examples} t={t} /> : <p className="note">{t("examples.empty")}</p>}
      </main>
    </SiteFrame>
  );
}
