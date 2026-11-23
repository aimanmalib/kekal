import type { Metadata } from "next";
import { SiteFrame } from "@/components/SiteFrame";
import { HolderPanel, type PanelSettings } from "@/components/warranty/HolderPanel";
import { WarrantyDetails, WarrantyMissing } from "@/components/warranty/WarrantyDetails";
import { runtimeCluster, webConfig } from "@/lib/config";
import { dataStore } from "@/lib/data";
import { translator } from "@/lib/i18n";
import { localeMetadata } from "@/lib/page-metadata";
import { relayRuntime } from "@/lib/relay/runtime";
import { requestLang } from "@/lib/request-lang";
import { readWarranty } from "@/lib/warranty/read";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await requestLang());
  // A warranty page is for its holder: keep it out of search results.
  return { ...(await localeMetadata()), title: `${t("card.title")} · ${t("app.name")}`, robots: { index: false, follow: false } };
}

function relayerAddress(): string | null {
  try {
    return relayRuntime().relayer.publicKey.toBase58();
  } catch {
    return null;
  }
}

function termsStore() {
  try {
    return dataStore();
  } catch {
    return { getWarrantyTerms: () => null };
  }
}

export default async function WarrantyPage({ params }: { params: Promise<{ pda: string }> }) {
  const { pda } = await params;
  const lang = await requestLang();
  const t = translator(lang);
  const cluster = runtimeCluster();
  const r = await readWarranty(pda, { store: termsStore(), cluster });
  if (!r.ok) {
    return (
      <SiteFrame lang={lang} t={t}>
        <WarrantyMissing reason={r.reason} t={t} />
      </SiteFrame>
    );
  }
  const w = webConfig.warrantyPage;
  const settings: PanelSettings = {
    keyFragment: w.keyFragment,
    storagePrefix: w.storagePrefix,
    pendingKeysMax: w.pendingKeysMax,
    activationRecheck: w.activationRecheck,
    confirmPollMs: w.confirmPollMs,
    confirmTimeoutMs: w.confirmTimeoutMs,
    claimMaxChars: w.claimMaxChars,
    countdownMaxSecs: w.countdownMaxSecs,
    issueTypes: w.issueTypes,
    explorerTx: cluster.explorerTx,
    currency: webConfig.currency,
  };
  return (
    <SiteFrame lang={lang} t={t}>
      <WarrantyDetails view={r.view} lang={lang} t={t} now={Math.floor(Date.now() / 1000) + r.view.clockSkew}>
        <HolderPanel view={r.view} lang={lang} relayer={relayerAddress()} settings={settings} />
      </WarrantyDetails>
    </SiteFrame>
  );
}
