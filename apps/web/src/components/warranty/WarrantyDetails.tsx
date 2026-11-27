import type { ReactNode } from "react";
import { webConfig } from "@/lib/config";
import { fill, type Lang, type MessageKey, type Translate } from "@/lib/i18n";
import { estimateLocal, formatDate, formatDateTime, formatUnits, relativeTime } from "@/lib/warranty/format";
import { readTerms } from "@/lib/warranty/terms";
import type { WarrantyView } from "@/lib/warranty/view";
import { WarrantyCard } from "../WarrantyCard";

const EVENT_LABELS: Record<string, MessageKey> = {
  WarrantyIssued: "event.WarrantyIssued",
  HolderTransferred: "event.HolderTransferred",
  ClaimFiled: "event.ClaimFiled",
  ClaimResponded: "event.ClaimResponded",
  ClaimStatusChanged: "event.ClaimStatusChanged",
  ReservePaid: "event.ReservePaid",
  WarrantyReleased: "event.WarrantyReleased",
  ShopDeclaredDormant: "event.ShopDeclaredDormant",
  HeartbeatSent: "event.HeartbeatSent",
};

/** Labels for one timeline entry, most telling first: a payout outranks the claim status change in the same transaction. */
export function entryLabels(events: string[], failed: boolean, t: Translate): string[] {
  if (failed) return [t("event.failed")];
  const known = [...new Set(events)].filter((e) => e in EVENT_LABELS);
  const shown = known.includes("ReservePaid") ? known.filter((e) => e !== "ClaimStatusChanged") : known;
  return shown.map((e) => t(EVENT_LABELS[e]!));
}

export type Activation = "activated" | "not_yet" | "unknown";

export function activation(v: WarrantyView): Activation {
  if (v.activatedAt !== null) return "activated";
  return v.timeline.some((e) => e.events.includes("WarrantyIssued")) ? "not_yet" : "unknown";
}

interface Props {
  view: WarrantyView;
  lang: Lang;
  t: Translate;
  now: number;
  /** The holder panel (client) slots in under the summary. */
  children?: ReactNode;
}

export function WarrantyDetails({ view: v, lang, t, now, children }: Props) {
  const terms = readTerms(v.terms.json, lang, webConfig.locales.fallback);
  const reserve = formatUnits(v.warranty.reserve, v.decimals);
  const status = v.claim?.open ? v.claim.statusKey : v.payout ? v.payout.statusKey : v.warranty.statusKey;
  const act = activation(v);
  return (
    <main className="warranty">
      <section className="warranty-head">
        <h1>{terms.product ?? fill(t("warranty.numbered"), { id: v.warranty.id })}</h1>
        <p className="lede">
          {v.shop.status === 0
            ? fill(t("warranty.shopActive"), { ago: relativeTime(v.shop.lastSeen, now, lang) })
            : fill(t("warranty.shopSilent"), { date: formatDate(v.shop.dormantAt, lang) })}
        </p>
        <p className="shop-link">
          <a href={`/kedai/${v.shop.owner}`}>{t("warranty.shopLink")}</a>
        </p>
        {act === "activated" && v.activatedAt !== null ? (
          <p className="note">{fill(t("warranty.activatedOn"), { date: formatDateTime(v.activatedAt, lang) })}</p>
        ) : act === "not_yet" ? (
          <p className="note">{t("warranty.notActivated")}</p>
        ) : null}
        {v.next ? (
          <p className="next">{fill(t(`next.${v.next.action}` as MessageKey), { time: formatDateTime(v.next.dueAt - v.clockSkew, lang) })}</p>
        ) : null}
        {children}
      </section>

      <WarrantyCard
        t={t}
        product={terms.product ?? fill(t("warranty.numbered"), { id: v.warranty.id })}
        reserve={reserve}
        currency={webConfig.currency}
        estimate={fill(t("amount.estimate"), { amount: estimateLocal(v.warranty.reserve, v.decimals) })}
        expires={formatDate(v.warranty.expiresAt, lang)}
        status={t(status as MessageKey)}
        stamp={v.payout ? t("stamp.paid") : null}
      />

      <section className="warranty-terms" aria-labelledby="terms-h">
        <h2 id="terms-h">{t("terms.heading")}</h2>
        {terms.promise ? <p className="promise">{terms.promise}</p> : null}
        <p className={v.terms.matches === false ? "check check-bad" : "check"}>
          {v.terms.matches === true ? t("terms.match") : v.terms.matches === false ? t("terms.mismatch") : t("terms.missing")}
        </p>
      </section>

      <section className="warranty-timeline" aria-labelledby="timeline-h">
        <h2 id="timeline-h">{t("timeline.heading")}</h2>
        <ol className="timeline">
          {v.timeline.map((e) => (
            <li key={e.signature}>
              <span className="when">{e.blockTime ? formatDateTime(e.blockTime, lang) : t("timeline.pending")}</span>
              <span className="what">{entryLabels(e.events, e.failed, t).join(" · ") || t("event.other")}</span>
              <a href={e.explorer} target="_blank" rel="noopener noreferrer">
                {t("timeline.record")}
              </a>
            </li>
          ))}
        </ol>
      </section>

      <details className="tech">
        <summary>{t("tech.summary")}</summary>
        <p>{t("tech.intro")}</p>
        <dl>
          {(
            [
              ["tech.warranty", v.pda],
              ["tech.shop", v.shop.address],
              ["tech.holder", v.warranty.holder],
              ["tech.mint", v.shop.mint],
              ["tech.program", v.programId],
              ["tech.reserveUnits", v.warranty.reserve],
              ["tech.termsHash", v.warranty.termsHash],
            ] as [MessageKey, string][]
          ).map(([k, val]) => (
            <div key={k}>
              <dt>{t(k)}</dt>
              <dd className="mono">{val}</dd>
            </div>
          ))}
        </dl>
      </details>
    </main>
  );
}

/** No card to show: a bad address, nothing at it, the network unreachable, or no program on the cluster yet. */
export function WarrantyMissing({ reason, t }: { reason: "bad_address" | "not_found" | "network" | "not_deployed"; t: Translate }) {
  return (
    <main className="warranty-missing">
      <h1>{t(`missing.${reason}.title` as MessageKey)}</h1>
      <p className="lede">{t(`missing.${reason}.body` as MessageKey)}</p>
      <p>
        <a className="button-link" href="/semak">
          {t("missing.checkAnother")}
        </a>
      </p>
    </main>
  );
}
