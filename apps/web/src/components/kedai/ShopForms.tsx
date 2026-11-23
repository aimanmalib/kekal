"use client";

import { useState, type FormEvent } from "react";
import { fill, type Translate } from "@/lib/i18n";
import { parseUnits } from "@/lib/warranty/format";

interface FundsProps {
  t: Translate;
  decimals: number;
  currency: string;
  busy: boolean;
  onDeposit: (amount: bigint) => void;
  onWithdraw: (amount: bigint) => void;
}

/** One amount, two buttons: put money into the shop's free reserve or take free reserve back. */
export function FundsForm({ t, decimals, currency, busy, onDeposit, onWithdraw }: FundsProps) {
  const [text, setText] = useState("");
  const amount = parseUnits(text, decimals);
  const ok = amount !== null && amount > 0n;
  return (
    <form className="form board-funds" onSubmit={(e) => e.preventDefault()}>
      <label>
        <span>{fill(t("kedai.funds.amount"), { currency })}</span>
        <input inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="button-row">
        <button type="button" className="button" disabled={busy || !ok} onClick={() => ok && onDeposit(amount)}>
          {t("kedai.funds.deposit")}
        </button>
        <button type="button" className="button button-quiet" disabled={busy || !ok} onClick={() => ok && onWithdraw(amount)}>
          {t("kedai.funds.withdraw")}
        </button>
      </div>
    </form>
  );
}

export interface IssueValues {
  product: string;
  serial: string;
  reserve: bigint;
  months: number;
  promise: { en: string; ms: string };
}

interface IssueProps {
  t: Translate;
  decimals: number;
  currency: string;
  busy: boolean;
  defaults: { reserve: string; months: number; promise: { en: string; ms: string } };
  termMonths: number[];
  max: { product: number; serial: number; promise: number };
  onSubmit: (v: IssueValues) => void;
}

/** Issue a warranty card: what was sold, how much the shop locks for the buyer, for how long, and the promise text. */
export function IssueForm({ t, decimals, currency, busy, defaults, termMonths, max, onSubmit }: IssueProps) {
  const [product, setProduct] = useState("");
  const [serial, setSerial] = useState("");
  const [reserve, setReserve] = useState(defaults.reserve);
  const [months, setMonths] = useState(defaults.months);
  const [en, setEn] = useState(defaults.promise.en);
  const [ms, setMs] = useState(defaults.promise.ms);
  const amount = parseUnits(reserve, decimals);
  const ready = product.trim() && serial.trim() && en.trim() && ms.trim() && amount !== null && amount > 0n;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready && amount) onSubmit({ product, serial, reserve: amount, months, promise: { en, ms } });
  };
  return (
    <form className="form" onSubmit={submit}>
      <label>
        <span>{t("kedai.issue.product")}</span>
        <input value={product} maxLength={max.product} required onChange={(e) => setProduct(e.target.value)} />
      </label>
      <label>
        <span>{t("kedai.issue.serial")}</span>
        <input value={serial} maxLength={max.serial} required autoComplete="off" onChange={(e) => setSerial(e.target.value)} />
      </label>
      <div className="form-pair">
        <label>
          <span>{fill(t("kedai.issue.reserve"), { currency })}</span>
          <input inputMode="decimal" value={reserve} required onChange={(e) => setReserve(e.target.value)} />
        </label>
        <label>
          <span>{t("kedai.issue.term")}</span>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {termMonths.map((m) => (
              <option key={m} value={m}>
                {fill(t("kedai.issue.months"), { n: m })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <span>{t("kedai.issue.promiseEn")}</span>
        <textarea rows={4} value={en} maxLength={max.promise} required onChange={(e) => setEn(e.target.value)} />
      </label>
      <label>
        <span>{t("kedai.issue.promiseMs")}</span>
        <textarea rows={4} value={ms} maxLength={max.promise} required lang="ms" onChange={(e) => setMs(e.target.value)} />
      </label>
      <p className="note">{t("kedai.issue.hint")}</p>
      <button type="submit" className="button" disabled={busy || !ready}>
        {t("kedai.issue.submit")}
      </button>
    </form>
  );
}

interface RespondProps {
  t: Translate;
  busy: boolean;
  maxChars: number;
  onRespond: (accept: boolean, reason: string) => void;
}

/** Accept (the shop will repair) or reject with a reason. A rejected buyer may still ask the arbiter. */
export function RespondForm({ t, busy, maxChars, onRespond }: RespondProps) {
  const [reason, setReason] = useState("");
  return (
    <form className="form" onSubmit={(e) => e.preventDefault()}>
      <label>
        <span>{t("kedai.claim.reason")}</span>
        <textarea rows={2} value={reason} maxLength={maxChars} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="button-row">
        <button type="button" className="button" disabled={busy} onClick={() => onRespond(true, reason)}>
          {t("kedai.claim.accept")}
        </button>
        <button type="button" className="button button-quiet" disabled={busy || !reason.trim()} onClick={() => onRespond(false, reason)}>
          {t("kedai.claim.reject")}
        </button>
      </div>
    </form>
  );
}
