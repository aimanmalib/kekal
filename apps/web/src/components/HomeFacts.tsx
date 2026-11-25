import Link from "next/link";
import { fill, type Translate } from "@/lib/i18n";
import type { ProgramStats } from "@/lib/shop/board";
import { formatUnits } from "@/lib/warranty/format";

interface Props {
  t: Translate;
  /** Null when the chain could not be read: the numbers are left out rather than shown as zero. */
  stats: ProgramStats | null;
  decimals: number;
  currency: string;
  /** Null while the program is not on the cluster: the closed demo is not offered, and the finished examples become the
   * main call to action. The address itself is in the row of links at the top of the page (JudgeLinks). */
  programId: string | null;
  network: string;
  /** False while no run is recorded for this cluster: /contoh is not offered, and with no program either there is no call to action. */
  examplesReady: boolean;
}

/** The demo call to action, live numbers read from the program and where to go next. */
export function HomeFacts({ t, stats, decimals, currency, programId, network, examplesReady }: Props) {
  return (
    <section className="home-facts">
      {programId || examplesReady ? (
        <p className="home-cta">
          {programId ? (
            <Link href="/demo" className="button">
              {t("home.cta")}
            </Link>
          ) : null}
          {examplesReady ? (
            <Link href="/contoh" className={programId ? "button button-link" : "button"}>
              {t("home.examples")}
            </Link>
          ) : null}
        </p>
      ) : null}
      {stats ? (
        <dl className="figures" aria-label={fill(t("home.stats.label"), { network })}>
          <div>
            <dt>{t("home.stats.shops")}</dt>
            <dd className="num">{stats.shops}</dd>
          </div>
          <div>
            <dt>{t("home.stats.active")}</dt>
            <dd className="num">{stats.activeWarranties}</dd>
          </div>
          <div>
            <dt>{t("home.stats.locked")}</dt>
            <dd className="num">
              {formatUnits(stats.locked, decimals)} <span className="unit">{currency}</span>
            </dd>
          </div>
          <div>
            <dt>{t("home.stats.paid")}</dt>
            <dd className="num">{stats.paidClaims}</dd>
          </div>
        </dl>
      ) : null}
      <ul className="home-links">
        <li>
          <Link href="/kedai">{t("home.link.kedai")}</Link>
        </li>
        <li>
          <Link href="/semak">{t("home.link.semak")}</Link>
        </li>
        <li>
          <Link href="/timbang">{t("home.link.timbang")}</Link>
        </li>
      </ul>
    </section>
  );
}
