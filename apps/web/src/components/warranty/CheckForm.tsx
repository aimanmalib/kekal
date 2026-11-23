"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { translator, type Lang } from "@/lib/i18n";
import { addressFromInput } from "@/lib/warranty/check";

/**
 * Takes a warranty address or a full card link and opens the read-only page. Any card key in a pasted link is dropped
 * here, in the browser, so it never reaches the server.
 */
export function CheckForm({ lang }: { lang: Lang }) {
  const t = translator(lang);
  const router = useRouter();
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const pda = addressFromInput(value);
    setBad(!pda);
    if (pda) router.push(`/w/${pda}`);
  };
  return (
    <form className="form check-form" onSubmit={submit} noValidate>
      <label>
        <span>{t("check.label")}</span>
        <input
          className="mono"
          value={value}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={bad}
          aria-describedby={bad ? "check-bad" : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {bad ? (
        <p id="check-bad" className="warn">
          {t("check.bad")}
        </p>
      ) : null}
      <button type="submit" className="button">
        {t("check.submit")}
      </button>
      <p className="note">{t("check.keyNote")}</p>
    </form>
  );
}
