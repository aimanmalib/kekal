import type { ReactNode } from "react";
import Link from "next/link";
import { webConfig } from "@/lib/config";
import type { Lang, MessageKey, Translate } from "@/lib/i18n";
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
      <footer className="foot">{t("footer.network")}</footer>
    </div>
  );
}
