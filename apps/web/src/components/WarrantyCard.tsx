import type { Translate } from "@/lib/i18n";
import { Guilloche } from "./Guilloche";

interface Props {
  t: Translate;
  reserve: string;
  currency: string;
}

/** The sample card on the home page. Pages that show a real warranty pass real values (P2d). */
export function WarrantyCard({ t, reserve, currency }: Props) {
  return (
    <figure className="card">
      <Guilloche width={360} height={44} lines={9} waves={6} />
      <div className="card-body">
        <p className="card-title">{t("card.title")}</p>
        <dl className="card-fields">
          <div>
            <dt>{t("card.product")}</dt>
            <dd>{t("card.sample.product")}</dd>
          </div>
          <div>
            <dt>{t("card.reserve")}</dt>
            <dd className="num">
              {reserve} <span className="unit">{currency}</span>
            </dd>
          </div>
          <div>
            <dt>{t("card.expires")}</dt>
            <dd>{t("card.sample.expires")}</dd>
          </div>
          <div>
            <dt>{t("card.status")}</dt>
            <dd>{t("status.claim.paidOrphan")}</dd>
          </div>
        </dl>
        <span className="stamp" aria-hidden="true">
          {t("stamp.paid")}
        </span>
      </div>
      <figcaption>{t("card.sample.note")}</figcaption>
    </figure>
  );
}
