"use client";

import { useCallback, useEffect, useState } from "react";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { fill, translator, type Lang, type MessageKey } from "@/lib/i18n";
import { readRemembered, SCENE_ROUTE, sceneSteps, scenePhase, type SceneKind } from "@/lib/demo/scene";
import { evidenceHash, fileClaimIxs, settleIxs } from "@/lib/warranty/actions";
import { ActionError, clientProgram, encodeSeed, keypairFromSeed, newSeed, seedFromFragment, sendViaRelay } from "@/lib/warranty/client";
import { clock, formatDate, formatUnits } from "@/lib/warranty/format";
import { readTerms } from "@/lib/warranty/terms";
import type { WarrantyView } from "@/lib/warranty/view";
import { webConfig } from "@/lib/web-config";
import { ClaimForm } from "../warranty/HolderForms";
import { WarrantyCard } from "../WarrantyCard";

export interface DemoSettings {
  storageKey: string;
  storagePrefix: string;
  pollMs: number;
  claimIssue: string;
  issueTypes: string[];
  claimMaxChars: number;
  confirmPollMs: number;
  confirmTimeoutMs: number;
  currency: string;
}

interface Props {
  kind: SceneKind;
  lang: Lang;
  relayer: string | null;
  settings: DemoSettings;
}

const KNOWN_ERRORS = new Set([
  "rate_ip", "rate_holder", "rate_global", "network", "failed_on_chain", "not_confirmed", "relayer_unavailable", "send_failed",
  "demo_unavailable", "demo_shop_missing",
]);

const errorKey = (code: string): MessageKey => (KNOWN_ERRORS.has(code) ? `error.${code}` : "error.generic") as MessageKey;

/** One scene of /demo: a warranty issued to a key made in this browser, followed live until the reserve is paid. */
export function DemoScene({ kind, lang, relayer, settings: s }: Props) {
  const t = translator(lang);
  const [pda, setPda] = useState<string | null>(null);
  const [key, setKey] = useState<Keypair | null>(null);
  const [view, setView] = useState<WarrantyView | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (address: string): Promise<WarrantyView | null> => {
    try {
      const res = await fetch(`/api/warranty/${address}`, { cache: "no-store" });
      if (!res.ok) return null;
      const next = (await res.json()) as WarrantyView;
      setView(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  // Resume a scene this browser started earlier (the warranty address and its key are both kept here).
  useEffect(() => {
    const address = readRemembered(window.localStorage.getItem(s.storageKey))[kind];
    const saved = address ? window.localStorage.getItem(s.storagePrefix + address) : null;
    const seed = saved ? seedFromFragment(`k=${saved}`, "k") : null;
    if (address && seed) {
      setPda(address);
      setKey(keypairFromSeed(seed));
      void refresh(address);
    }
  }, [kind, s.storageKey, s.storagePrefix, refresh]);

  const skew = view?.clockSkew ?? 0;
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000) + skew);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [skew]);

  const phase = view && now !== null ? scenePhase(kind, view, now) : null;
  const following = phase?.kind === "wait" || phase?.kind === "due";

  // While a deadline runs, read the warranty again: the keeper may send the step first.
  useEffect(() => {
    if (!pda || !following || busy) return;
    const id = window.setInterval(() => void refresh(pda), s.pollMs);
    return () => window.clearInterval(id);
  }, [pda, following, busy, s.pollMs, refresh]);

  function remember(address: string | null) {
    const all = readRemembered(window.localStorage.getItem(s.storageKey));
    if (address) all[kind] = address;
    else delete all[kind];
    window.localStorage.setItem(s.storageKey, JSON.stringify(all));
  }

  async function start() {
    setBusy(true);
    setError(null);
    const seed = newSeed();
    const holder = keypairFromSeed(seed);
    try {
      const res = await fetch(SCENE_ROUTE[kind], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ holder: holder.publicKey.toBase58() }),
      });
      const body = (await res.json().catch(() => ({}))) as { warranty?: string; error?: string };
      if (!res.ok || !body.warranty) throw new ActionError(body.error ?? "send_failed");
      // The key is kept where /w/[pda] looks for it, so the warranty page knows this browser holds the card.
      window.localStorage.setItem(s.storagePrefix + body.warranty, encodeSeed(seed));
      remember(body.warranty);
      setKey(holder);
      setPda(body.warranty);
      if (!(await refresh(body.warranty))) setError("network");
    } catch (e) {
      setError(e instanceof ActionError ? e.code : "network");
    } finally {
      setBusy(false);
    }
  }

  async function send(build: () => Promise<TransactionInstruction[]>) {
    if (!relayer || !key || !pda) return;
    setBusy(true);
    setError(null);
    let failed: string | null = null;
    try {
      await sendViaRelay(await build(), relayer, [key], { pollMs: s.confirmPollMs, timeoutMs: s.confirmTimeoutMs });
    } catch (e) {
      failed = e instanceof ActionError ? e.code : "generic";
    }
    // A step the keeper sent first fails here, but the warranty is paid all the same: then there is nothing to report.
    const after = await refresh(pda);
    setError(after?.payout ? null : failed);
    setBusy(false);
  }

  function reset() {
    remember(null);
    setPda(null);
    setKey(null);
    setView(null);
    setError(null);
  }

  const program = () => clientProgram(view!.programId);
  const relayerKey = () => new PublicKey(relayer!);
  const steps = view ? sceneSteps(view) : [];
  const terms = view ? readTerms(view.terms.json, lang, webConfig.locales.fallback) : null;

  return (
    <section className="scene" aria-labelledby={`scene-${kind}`}>
      <div className="scene-text">
        <h2 id={`scene-${kind}`}>{t(`demo.${kind}.title`)}</h2>
        <p>{t(`demo.${kind}.lede`)}</p>
        {!pda ? (
          <button type="button" className="button" disabled={busy} onClick={() => void start()}>
            {t(`demo.${kind}.start`)}
          </button>
        ) : null}
        {pda && !view && !error ? <p className="note">{t("demo.reading")}</p> : null}

        {steps.length > 0 ? (
          <ol className="steps">
            {steps.map((st) => (
              <li key={st.signature}>
                <strong>{t(st.label)}</strong> <span>{t(st.why)}</span>{" "}
                <a href={st.explorer} target="_blank" rel="noopener noreferrer">
                  {t("timeline.record")}
                </a>
              </li>
            ))}
          </ol>
        ) : null}

        {phase?.kind === "claim" && key ? (
          <>
            <p className="next">{t("demo.silent.claimHint")}</p>
            <ClaimForm
              t={t}
              issueTypes={[s.claimIssue, ...s.issueTypes.filter((x) => x !== s.claimIssue)]}
              maxChars={s.claimMaxChars}
              busy={busy || !relayer}
              onSubmit={(issue, text) =>
                void send(() => fileClaimIxs(program(), view!, relayerKey(), key.publicKey, evidenceHash(issue, text)))
              }
            />
          </>
        ) : null}
        {phase?.kind === "wait" && now !== null ? (
          <p className="countdown" role="timer">
            {fill(t(`demo.wait.${phase.action}` as MessageKey), { left: clock(phase.dueAt - now) })}
          </p>
        ) : null}
        {phase?.kind === "due" && key ? (
          <div className="panel-block">
            <p>{t(`settle.${phase.action}.body` as MessageKey)}</p>
            <button
              type="button"
              className="button"
              disabled={busy || !relayer}
              onClick={() => void send(() => settleIxs(program(), view!, phase.action, relayerKey(), key.publicKey))}
            >
              {t(`settle.${phase.action}.button` as MessageKey)}
            </button>
          </div>
        ) : null}
        {phase?.kind === "paid" ? <p className="ok">{fill(t("demo.paid"), { amount: formatUnits(phase.amount, view!.decimals), currency: s.currency })}</p> : null}

        {!relayer && pda ? <p className="warn">{t("error.relayer_unavailable")}</p> : null}
        {busy && pda ? <p className="note">{t("panel.sending")}</p> : null}
        {error ? (
          <p className="warn" role="alert">
            {t(errorKey(error))}
          </p>
        ) : null}
        {pda ? (
          <p className="scene-links">
            <a href={`/w/${pda}`}>{t("demo.openCard")}</a>
            <button type="button" className="link-button" disabled={busy} onClick={reset}>
              {t("demo.again")}
            </button>
          </p>
        ) : null}
      </div>

      {view && terms ? (
        <WarrantyCard
          t={t}
          product={terms.product ?? fill(t("warranty.numbered"), { id: view.warranty.id })}
          reserve={formatUnits(view.warranty.reserve, view.decimals)}
          currency={s.currency}
          expires={formatDate(view.warranty.expiresAt, lang)}
          status={t((view.claim?.open ? view.claim.statusKey : view.payout ? view.payout.statusKey : view.warranty.statusKey) as MessageKey)}
          stamp={view.payout ? t("stamp.paid") : null}
        />
      ) : null}
    </section>
  );
}
