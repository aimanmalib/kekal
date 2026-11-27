import type { Metadata } from "next";
import { SiteFrame } from "@/components/SiteFrame";
import { HomeCta, HomeFacts } from "@/components/HomeFacts";
import { JudgeLinks } from "@/components/JudgeLinks";
import { PhoneFrame } from "@/components/PhoneFrame";
import { WarrantyCard } from "@/components/WarrantyCard";
import { HowItWorks } from "@/components/home/HowItWorks";
import { PrintedCard } from "@/components/home/PrintedCard";
import { HomeLimits, HomeQuestions, HomeWhy } from "@/components/home/HomeReading";
import { SeeItHappen } from "@/components/home/SeeItHappen";
import { clusterSettings } from "@kekal/server";
import { runtimeCluster, sampleReserve, webConfig } from "@/lib/config";
import { siteExamples } from "@/lib/demo/site-examples";
import { translator, type MessageKey } from "@/lib/i18n";
import { localeMetadata } from "@/lib/page-metadata";
import { requestLang } from "@/lib/request-lang";
import { readProgramStats } from "@/lib/shop/read";
import { sampleCard } from "@/lib/shop/sample-card";

const rules: MessageKey[] = ["home.rule.silent", "home.rule.gone", "home.rule.expired"];

// Listing the card here keeps its locale alt text; see src/lib/page-metadata.ts.
export async function generateMetadata(): Promise<Metadata> {
  return localeMetadata();
}

export default async function Home() {
  const lang = await requestLang();
  const t = translator(lang);
  const cluster = runtimeCluster();
  // Nothing to read while the program is not on the cluster: skip the RPC call rather than wait for its timeout.
  const stats = !cluster.deployed ? null : await Promise.race([
    readProgramStats(Math.floor(Date.now() / 1000), { cluster }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), webConfig.home.statsTimeoutMs)),
  ]).catch(() => null);
  const network = t(`cluster.${cluster.name}` as MessageKey);
  const examples = siteExamples(cluster.name);
  const printed = await sampleCard(lang, sampleReserve(), cluster.deployed);
  const explorer = clusterSettings(cluster.name).explorerAddress.replace("{address}", cluster.programId);
  return (
    <SiteFrame lang={lang} t={t}>
      <main className="home">
        <JudgeLinks
          t={t}
          videoUrl={webConfig.home.videoUrl}
          repoUrl={webConfig.home.repoUrl}
          program={cluster.deployed ? { id: cluster.programId, explorer } : null}
          network={network}
        />
        <h1 className="home-title">{t("home.title")}</h1>
        <p className="home-story">{t("home.story")}</p>
        <div className="hero-cta">
          <HomeCta t={t} programId={cluster.deployed ? cluster.programId : null} examplesReady={examples !== null} />
        </div>
        {/* The printed card the buyer keeps, and the same card on the phone once the shop went silent. */}
        <div className="hero-objects">
          <PrintedCard card={printed} label={t("home.print.label")} />
          <PhoneFrame
            label={t("home.phone.label")}
            title={t("app.name")}
            caption={t(cluster.deployed ? "card.sample.note" : "card.sample.notePending")}
          >
            <WarrantyCard
              t={t}
              product={t("card.sample.product")}
              reserve={sampleReserve()}
              currency={webConfig.currency}
              expires={t("card.sample.expires")}
              status={t("status.claim.paidOrphan")}
              stamp={t("stamp.paid")}
            />
          </PhoneFrame>
        </div>
        <section className="intro">
          <p className="lede">{t("home.lede")}</p>
          <ul className="rules">
            {rules.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
          <HomeFacts
            t={t}
            stats={stats}
            decimals={cluster.tokenDecimals}
            currency={webConfig.currency}
            network={network}
          />
        </section>
        <HowItWorks t={t} lang={lang} />
        <SeeItHappen
          t={t}
          examples={examples}
          order={webConfig.examples.paths}
          network={network}
          videoUrl={webConfig.home.videoUrl}
        />
        <HomeWhy t={t} sourceUrl={webConfig.home.whySourceUrl} />
        <HomeQuestions t={t} />
        <HomeLimits t={t} />
      </main>
    </SiteFrame>
  );
}
