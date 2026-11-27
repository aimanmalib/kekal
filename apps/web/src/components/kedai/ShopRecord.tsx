import { webConfig } from "@/lib/config";
import { fill, type Lang, type MessageKey, type Translate } from "@/lib/i18n";
import { qrMatrix } from "@/lib/shop/card";
import { shopState, type PublicShop } from "@/lib/shop/public";
import { formatDate, formatDateTime, formatSpan, formatUnits, relativeTime } from "@/lib/warranty/format";
import { Guilloche } from "../Guilloche";
import { PrintButton } from "./PrintButton";

interface Props {
  view: PublicShop;
  lang: Lang;
  t: Translate;
  now: number;
  /** Explorer page of an account: the cluster's explorerAddress template. */
  addressUrl: (address: string) => string;
  /** Absolute address of this page, for the QR code. */
  pageUrl: string;
}

function Fig({ label, value, href, sub }: { label: string; value: string; href: string; sub?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <a className="num fig-link" href={href} target="_blank" rel="noopener noreferrer">
          {value}
        </a>
        {sub ? <span className="fig-sub">{sub}</span> : null}
      </dd>
    </div>
  );
}

/** The public record of one shop: what it has locked for buyers, whether it still checks in, and the claim windows. */
export function ShopRecord({ view: v, lang, t, now, addressUrl, pageUrl }: Props) {
  const s = v.shop;
  const money = (base: string) => `${formatUnits(base, v.decimals)} ${webConfig.currency}`;
  const state = shopState(v, now);
  const shopLink = addressUrl(s.address);
  const qr = qrMatrix(pageUrl);
  const margin = webConfig.shopBoard.card.qrMargin;
  const cells = qr.size + 2 * margin;
  const band = webConfig.shopPage.band;
  const windows: [MessageKey, number][] = [
    ["shopPage.windows.response", s.windows.responseSecs],
    ["shopPage.windows.repair", s.windows.repairSecs],
    ["shopPage.windows.dispute", s.windows.disputeSecs],
    ["shopPage.windows.heartbeat", s.windows.heartbeatSecs],
    ["shopPage.windows.grace", s.windows.graceSecs],
  ];
  return (
    <main className="shop-record">
      <section className="shop-record-head">
        <h1>{t("shopPage.title")}</h1>
        <p className="lede">{t("shopPage.lede")}</p>
        <p className={state === "active" ? "shop-state" : "shop-state shop-state-alert"}>
          {state === "silent"
            ? fill(t("shopPage.state.silent"), { date: formatDate(s.dormantAt, lang) })
            : state === "late"
              ? fill(t("shopPage.state.late"), { due: formatDateTime(v.checkInDue, lang), silent: formatDateTime(s.silentAt, lang) })
              : fill(t("shopPage.state.active"), { ago: relativeTime(s.lastSeen, now, lang), due: formatDate(v.checkInDue, lang) })}
        </p>
      </section>

      <section className="board-section" aria-labelledby="shop-reserve-h">
        <h2 id="shop-reserve-h">{t("shopPage.reserve.heading")}</h2>
        <p>{t("shopPage.reserve.note")}</p>
        <dl className="figures">
          <Fig label={t("shopPage.fig.locked")} value={money(s.locked)} href={addressUrl(v.vault)} />
          <Fig label={t("shopPage.fig.free")} value={money(s.free)} href={addressUrl(v.vault)} />
          <Fig label={t("shopPage.fig.live")} value={String(s.activeWarranties)} href={shopLink} sub={fill(t("shopPage.fig.issued"), { n: s.issued })} />
          <Fig label={t("shopPage.fig.paid")} value={money(s.paidAmount)} href={shopLink} sub={fill(t("shopPage.fig.paidCount"), { n: s.paidCount })} />
          <Fig label={t("shopPage.fig.lastSeen")} value={formatDateTime(s.lastSeen, lang)} href={shopLink} />
          <Fig label={t("shopPage.fig.due")} value={formatDateTime(v.checkInDue, lang)} href={shopLink} />
        </dl>
      </section>

      <section className="board-section" aria-labelledby="shop-windows-h">
        <h2 id="shop-windows-h">{t("shopPage.windows.heading")}</h2>
        <dl className="shop-windows">
          {windows.map(([k, secs]) => (
            <div key={k}>
              <dt>{t(k)}</dt>
              <dd>
                <a className="num fig-link" href={shopLink} target="_blank" rel="noopener noreferrer">
                  {formatSpan(secs, lang)}
                </a>
              </dd>
            </div>
          ))}
          <div>
            <dt>{t("shopPage.windows.arbiter")}</dt>
            <dd>
              <a className="mono fig-link" href={addressUrl(s.arbiter)} target="_blank" rel="noopener noreferrer">
                {s.arbiter}
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section className="board-section shop-slip-section" aria-labelledby="shop-slip-h">
        <h2 id="shop-slip-h">{t("shopPage.slip.heading")}</h2>
        <p>{t("shopPage.slip.body")}</p>
        <figure className="shop-slip">
          <Guilloche width={band.width} height={band.height} lines={band.lines} waves={band.waves} />
          <div className="shop-slip-body">
          <svg className="shop-slip-qr" viewBox={`0 0 ${cells} ${cells}`} role="img" aria-label={t("shopPage.slip.qrAlt")} shapeRendering="crispEdges">
            <rect width={cells} height={cells} className="qr-paper" />
            {qr.dark.map((on, i) =>
              on ? <rect key={i} x={(i % qr.size) + margin} y={Math.floor(i / qr.size) + margin} width={1} height={1} className="qr-ink" /> : null,
            )}
          </svg>
          <figcaption>
            <span>{t("shopPage.slip.caption")}</span>
            <span className="mono">{pageUrl}</span>
          </figcaption>
          </div>
        </figure>
        <PrintButton label={t("shopPage.slip.print")} />
      </section>

      <p className="shop-check">
        <a className="button-link" href="/semak">
          {t("shopPage.check")}
        </a>
      </p>

      <details className="tech">
        <summary>{t("tech.summary")}</summary>
        <p>{t("shopPage.tech.intro")}</p>
        <dl>
          {(
            [
              ["tech.shop", s.address],
              ["shopPage.tech.owner", v.owner],
              ["shopPage.tech.vault", v.vault],
              ["tech.mint", s.mint],
              ["tech.program", v.programId],
            ] as [MessageKey, string][]
          ).map(([k, val]) => (
            <div key={k}>
              <dt>{t(k)}</dt>
              <dd className="mono">
                <a href={addressUrl(val)} target="_blank" rel="noopener noreferrer">
                  {val}
                </a>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </main>
  );
}

/** No public record to show: a bad address, no shop under it, or the network unreachable. */
export function ShopRecordMissing({ reason, t }: { reason: "not_found" | "network"; t: Translate }) {
  return (
    <main className="warranty-missing">
      <h1>{t(`shopPage.missing.${reason}.title` as MessageKey)}</h1>
      <p className="lede">{t(`shopPage.missing.${reason}.body` as MessageKey)}</p>
      <p>
        <a className="button-link" href="/semak">
          {t("shopPage.check")}
        </a>
      </p>
    </main>
  );
}
