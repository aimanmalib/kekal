import { LangSwitch } from "@/components/LangSwitch";
import { WarrantyCard } from "@/components/WarrantyCard";
import { sampleReserve, webConfig } from "@/lib/config";
import { translator, type MessageKey } from "@/lib/i18n";
import { requestLang } from "@/lib/request-lang";

const rules: MessageKey[] = ["home.rule.silent", "home.rule.gone", "home.rule.expired"];

export default async function Home() {
  const lang = await requestLang();
  const t = translator(lang);
  return (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">{t("app.name")}</span>
        <LangSwitch
          current={lang}
          label={t("lang.label")}
          cookie={webConfig.locales.cookie}
          maxAgeDays={webConfig.locales.cookieMaxAgeDays}
          options={webConfig.locales.supported.map((v) => ({ value: v, label: t(`lang.${v}` as MessageKey) }))}
        />
      </header>
      <main className="home">
        <section className="intro">
          <h1>{t("home.title")}</h1>
          <p className="lede">{t("home.lede")}</p>
          <ul className="rules">
            {rules.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </section>
        <WarrantyCard t={t} reserve={sampleReserve()} currency={webConfig.currency} />
      </main>
      <footer className="foot">{t("footer.network")}</footer>
    </div>
  );
}
