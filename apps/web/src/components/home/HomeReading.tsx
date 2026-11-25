import type { MessageKey, Translate } from "@/lib/i18n";

const QUESTIONS = ["lock", "arbiter", "database", "stablecoin", "heartbeat", "code"] as const;
/** Same list and order as the Limits section of the README. */
const LIMITS = ["devnet", "cashout", "arbiter", "admin", "keeper", "capital", "bearer"] as const;

/** Why the project exists, with the source of the insurance comparison (config web.home.whySourceUrl). */
export function HomeWhy({ t, sourceUrl }: { t: Translate; sourceUrl: string }) {
  return (
    <section className="home-section why" aria-labelledby="why-title">
      <h2 id="why-title">{t("home.why.title")}</h2>
      <p>{t("home.why.promise")}</p>
      <p>
        {t("home.why.insurance")}{" "}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="source">
          {t("home.why.source")}
        </a>
      </p>
      <p>{t("home.why.program")}</p>
      <p className="why-origin">{t("home.why.origin")}</p>
    </section>
  );
}

/** The questions a reviewer asks first, answered plainly; all open, so nothing has to be clicked to read them. */
export function HomeQuestions({ t }: { t: Translate }) {
  return (
    <section className="home-section faq" aria-labelledby="faq-title">
      <h2 id="faq-title">{t("home.faq.title")}</h2>
      <dl className="qa">
        {QUESTIONS.map((q) => (
          <div key={q}>
            <dt>{t(`home.faq.${q}.q` as MessageKey)}</dt>
            <dd>{t(`home.faq.${q}.a` as MessageKey)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** What the project does not do yet, stated as plainly as in the README. */
export function HomeLimits({ t }: { t: Translate }) {
  return (
    <section className="home-section limits" aria-labelledby="limits-title">
      <h2 id="limits-title">{t("home.limits.title")}</h2>
      <ul>
        {LIMITS.map((l) => (
          <li key={l}>{t(`home.limits.${l}` as MessageKey)}</li>
        ))}
      </ul>
    </section>
  );
}
