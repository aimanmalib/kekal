"use client";

import { useState, type FormEvent } from "react";
import { PublicKey } from "@solana/web3.js";
import { fill, type MessageKey, type Translate } from "@/lib/i18n";
import { parseUnits } from "@/lib/warranty/format";

interface ClaimProps {
  t: Translate;
  issueTypes: string[];
  maxChars: number;
  busy: boolean;
  onSubmit: (issueType: string, description: string) => void;
}

/** Claim form: a category and a short description. Only a fingerprint of the text is recorded. */
export function ClaimForm({ t, issueTypes, maxChars, busy, onSubmit }: ClaimProps) {
  const [issue, setIssue] = useState(issueTypes[0] ?? "other");
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onSubmit(issue, text);
  };
  return (
    <form className="panel-block form" onSubmit={submit}>
      <h2>{t("claim.heading")}</h2>
      <label>
        <span>{t("claim.issue")}</span>
        <select value={issue} onChange={(e) => setIssue(e.target.value)}>
          {issueTypes.map((k) => (
            <option key={k} value={k}>
              {t(`claim.issue.${k}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("claim.description")}</span>
        <textarea value={text} maxLength={maxChars} rows={4} required onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="note">{t("claim.privacy")}</p>
      <button type="submit" className="button" disabled={busy || !text.trim()}>
        {t("claim.submit")}
      </button>
    </form>
  );
}

interface SendProps {
  t: Translate;
  balance: string;
  currency: string;
  decimals: number;
  busy: boolean;
  onSubmit: (to: PublicKey, amount: bigint) => void;
}

/** Moves paid-out money to an address the buyer chooses. */
export function SendForm({ t, balance, currency, decimals, busy, onSubmit }: SendProps) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(balance);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    let dest: PublicKey;
    try {
      dest = new PublicKey(to.trim());
    } catch {
      setProblem("send.badAddress");
      return;
    }
    const units = parseUnits(amount, decimals);
    const max = parseUnits(balance, decimals) ?? 0n;
    if (units === null || units <= 0n || units > max) {
      setProblem("send.badAmount");
      return;
    }
    setProblem(null);
    onSubmit(dest, units);
  };
  return (
    <form className="panel-block form" onSubmit={submit}>
      <h2>{t("send.heading")}</h2>
      <p>
        {fill(t("send.balance"), { amount: balance, currency })}
      </p>
      <label>
        <span>{t("send.to")}</span>
        <input className="mono" value={to} autoComplete="off" spellCheck={false} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label>
        <span>{fill(t("send.amount"), { currency })}</span>
        <input className="mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {problem ? <p className="warn">{t(problem)}</p> : null}
      <button type="submit" className="button" disabled={busy}>
        {t("send.submit")}
      </button>
    </form>
  );
}
