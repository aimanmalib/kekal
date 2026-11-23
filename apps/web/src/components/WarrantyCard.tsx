import type { Translate } from "@/lib/i18n";
import { Guilloche } from "./Guilloche";

interface Props {
  t: Translate;
  product: string;
  reserve: string;
  currency: string;
  /** Approximate local figure, already labelled (e.g. "about RM 110"). */
  estimate?: string;
  expires: string;
  status: string;
  /** Shown only when money has moved. */
  stamp?: string | null;
  note?: string | null;
}

/** The warranty card: the sample on the home page and the real card on /w/[pda]. */
export function WarrantyCard({ t, product, reserve, currency, estimate, expires, status, stamp, note }: Props) {
  return (
    <figure className="card">
      <Guilloche width={360} height={44} lines={9} waves={6} />
      <div className="card-body">
        <p className="card-title">{t("card.title")}</p>
        <dl className="card-fields">
          <div>
            <dt>{t("card.product")}</dt>
            <dd>{product}</dd>
          </div>
          <div>
            <dt>{t("card.reserve")}</dt>
            <dd className="num">
              {reserve} <span className="unit">{currency}</span>
              {estimate ? <span className="estimate">{estimate}</span> : null}
            </dd>
          </div>
          <div>
            <dt>{t("card.expires")}</dt>
            <dd>{expires}</dd>
          </div>
          <div>
            <dt>{t("card.status")}</dt>
            <dd>{status}</dd>
          </div>
        </dl>
        {stamp ? (
          <span className="stamp" aria-hidden="true">
            {stamp}
          </span>
        ) : null}
      </div>
      {note ? <figcaption>{note}</figcaption> : null}
    </figure>
  );
}
