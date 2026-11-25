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
  /** Null while the program is not on the cluster: the address line is left out rather than linking to nothing,
   * the closed demo is not offered, and the finished examples become the main call to action. */
  programId: string | null;
  explorer: string;
  network: string;
  /** False while no run is recorded for this cluster: /contoh only describes the paths, so it is a quiet link. */
  examplesReady: boolean;
  repoUrl: string | null;
  videoUrl: string | null;
}

/** The demo call to action, live numbers read from the program, the program address and where to go next. */
export function HomeFacts({ t, stats, decimals, currency, programId, explorer, network, examplesReady, repoUrl, videoUrl }: Props) {
  return (
    <section className="home-facts">
      <p className="home-cta">
        {programId ? (
          <Link href="/demo" className="button">
            {t("home.cta")}
          </Link>
        ) : null}
        <Link href="/contoh" className={programId || !examplesReady ? "button button-link" : "button"}>
          {t(examplesReady ? "home.examples" : "home.examplesPending")}
        </Link>
      </p>
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
      {programId ? (
        <p className="note">
          {fill(t("home.program"), { network })}{" "}
          <a className="mono" href={explorer} target="_blank" rel="noopener noreferrer">
            {programId}
          </a>
        </p>
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
        {repoUrl ? (
          <li>
            <a href={repoUrl}>{t("home.link.repo")}</a>
          </li>
        ) : null}
        {videoUrl ? (
          <li>
            <a href={videoUrl}>{t("home.link.video")}</a>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
