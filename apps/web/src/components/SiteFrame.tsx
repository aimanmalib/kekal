import type { ReactNode } from "react";
import Link from "next/link";
import { runtimeCluster, webConfig } from "@/lib/config";
import { fill, type Lang, type MessageKey, type Translate } from "@/lib/i18n";
import { LangSwitch } from "./LangSwitch";

/** Masthead, page body and footer shared by every page. */
export function SiteFrame({ lang, t, children }: { lang: Lang; t: Translate; children: ReactNode }) {
  return (
    <div className="page">
      <header className="masthead">
        <Link href="/" className="wordmark">
          {t("app.name")}
        </Link>
        <LangSwitch
          current={lang}
          label={t("lang.label")}
          cookie={webConfig.locales.cookie}
          maxAgeDays={webConfig.locales.cookieMaxAgeDays}
          options={webConfig.locales.supported.map((v) => ({ value: v, label: t(`lang.${v}` as MessageKey) }))}
        />
      </header>
      {children}
      <footer className="foot">{fill(t("footer.network"), { network: t(`cluster.${runtimeCluster().name}` as MessageKey) })}</footer>
    </div>
  );
}
