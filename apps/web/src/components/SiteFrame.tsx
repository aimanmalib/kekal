import type { ReactNode } from "react";
import Link from "next/link";
import { runtimeCluster, webConfig } from "@/lib/config";
import { fill, type Lang, type MessageKey, type Translate } from "@/lib/i18n";
import { LangSwitch } from "./LangSwitch";

/** Masthead, page body and footer shared by every page. */
export function SiteFrame({ lang, t, children }: { lang: Lang; t: Translate; children: ReactNode }) {
  const cluster = runtimeCluster();
  const network = t(`cluster.${cluster.name}` as MessageKey);
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
      {cluster.deployed ? null : (
        <p className="program-notice" role="status">
          {fill(t("notice.notDeployed"), { network })}
        </p>
      )}
      {children}
      <footer className="foot">{fill(t("footer.network"), { network })}</footer>
    </div>
  );
}
