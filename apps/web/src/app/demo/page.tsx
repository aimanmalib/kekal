import type { Metadata } from "next";
import Link from "next/link";
import { SiteFrame } from "@/components/SiteFrame";
import { DemoScene, type DemoSettings } from "@/components/demo/DemoScene";
import { webConfig } from "@/lib/config";
import { SCENES } from "@/lib/demo/scene";
import { translator } from "@/lib/i18n";
import { localeMetadata } from "@/lib/page-metadata";
import { relayerAddress } from "@/lib/relay/runtime";
import { requestLang } from "@/lib/request-lang";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await requestLang());
  return { ...(await localeMetadata()), title: `${t("demo.title")} · ${t("app.name")}` };
}

export default async function DemoPage() {
  const lang = await requestLang();
  const t = translator(lang);
  const w = webConfig.warrantyPage;
  const d = webConfig.demoPage;
  const settings: DemoSettings = {
    storageKey: d.storageKey,
    storagePrefix: w.storagePrefix,
    pollMs: d.pollMs,
    claimIssue: d.claimIssue,
    issueTypes: w.issueTypes,
    claimMaxChars: w.claimMaxChars,
    confirmPollMs: w.confirmPollMs,
    confirmTimeoutMs: w.confirmTimeoutMs,
    currency: webConfig.currency,
  };
  const relayer = relayerAddress();
  return (
    <SiteFrame lang={lang} t={t}>
      <main className="demo">
        <section className="demo-head">
          <h1>{t("demo.title")}</h1>
          <p className="lede">{t("demo.lede")}</p>
          <p className="note">
            {t("demo.noWait")} <Link href="/contoh">{t("demo.examplesLink")}</Link>
          </p>
        </section>
        {SCENES.map((kind) => (
          <DemoScene key={kind} kind={kind} lang={lang} relayer={relayer} settings={settings} />
        ))}
      </main>
    </SiteFrame>
  );
}
