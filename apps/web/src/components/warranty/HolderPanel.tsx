"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { PermissionlessAction } from "@kekal/sdk";
import { fill, translator, type Lang, type MessageKey } from "@/lib/i18n";
import { activateIxs, fileClaimIxs, holderClaimIxs, holderTokenAccount, evidenceHash, settleIxs, sendIxs } from "@/lib/warranty/actions";
import { ActionError, cardLink, clientProgram, encodeSeed, keypairFromSeed, newSeed, seedFromFragment, sendViaRelay, tokenBalance } from "@/lib/warranty/client";
import { clock, formatUnits } from "@/lib/warranty/format";
import { holderActions, keyState, type WarrantyView } from "@/lib/warranty/view";
import { ClaimForm, SendForm } from "./HolderForms";

export interface PanelSettings {
  keyFragment: string;
  storagePrefix: string;
  confirmPollMs: number;
  confirmTimeoutMs: number;
  claimMaxChars: number;
  countdownMaxSecs: number;
  issueTypes: string[];
  explorerTx: string;
  currency: string;
}

interface Props {
  view: WarrantyView;
  lang: Lang;
  /** Null when the relayer key is not loaded: actions are hidden and the page says so. */
  relayer: string | null;
  settings: PanelSettings;
}

const ERRORS = new Set(["send_failed", "rate_ip", "rate_holder", "rate_global", "network", "failed_on_chain", "not_confirmed", "relayer_unavailable"]);

export function HolderPanel({ view: v, lang, relayer, settings: s }: Props) {
  const t = translator(lang);
  const router = useRouter();
  // Chain time: deadlines are checked against the cluster clock, which may differ from this device's clock.
  // Null until mounted, so the server render and the first client render agree (no clock in either).
  const [now, setNow] = useState<number | null>(null);
  const [card, setCard] = useState<Keypair | null>(null);
  const [stored, setStored] = useState<Keypair | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const storageKey = s.storagePrefix + v.pda;

  useEffect(() => {
    const seed = seedFromFragment(window.location.hash, s.keyFragment);
    if (seed) setCard(keypairFromSeed(seed));
    const saved = window.localStorage.getItem(storageKey);
    const savedSeed = saved ? seedFromFragment(`${s.keyFragment}=${saved}`, s.keyFragment) : null;
    if (savedSeed) setStored(keypairFromSeed(savedSeed));
    const tick = () => setNow(Math.floor(Date.now() / 1000) + v.clockSkew);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [s.keyFragment, storageKey, v.clockSkew]);

  const state = keyState(v.warranty.holder, stored?.publicKey.toBase58() ?? null, card?.publicKey.toBase58() ?? null);
  const holderKey = state === "holder" ? stored : state === "card-unactivated" ? card : null;
  const actions = useMemo(() => (holderKey && now !== null ? holderActions(v, now) : []), [holderKey, v, now]);

  const refreshBalance = useCallback(async (key: PublicKey) => {
    try {
      setBalance(await tokenBalance(holderTokenAccount(v, key).toBase58()));
    } catch {
      setBalance(null);
    }
  }, [v]);

  useEffect(() => {
    if (state === "holder" && stored) void refreshBalance(stored.publicKey);
  }, [state, stored, refreshBalance]);

  async function run(build: () => Promise<TransactionInstruction[]>, signers: Keypair[], after?: () => void) {
    if (!relayer) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const sig = await sendViaRelay(await build(), relayer, signers, { pollMs: s.confirmPollMs, timeoutMs: s.confirmTimeoutMs });
      after?.();
      setDone(sig);
      router.refresh();
    } catch (e) {
      const code = e instanceof ActionError ? e.code : "generic";
      setError(ERRORS.has(code) ? code : "generic");
    } finally {
      setBusy(false);
    }
  }

  const program = () => clientProgram(v.programId);
  const relayerKey = () => new PublicKey(relayer!);

  function activate() {
    if (!card) return;
    const seed = newSeed();
    const next = keypairFromSeed(seed);
    void run(() => activateIxs(program(), v, card.publicKey, next.publicKey), [card], () => {
      window.localStorage.setItem(storageKey, encodeSeed(seed));
      setStored(next);
      setFresh(cardLink(window.location.origin, v.pda, s.keyFragment, seed));
      window.history.replaceState(null, "", `/w/${v.pda}`);
    });
  }

  const due = v.next && now !== null && now >= v.next.dueAt ? v.next.action : null;
  const left = v.next && now !== null ? v.next.dueAt - now : Infinity;
  const showCountdown = v.next && !due && left <= s.countdownMaxSecs;

  function settle(action: PermissionlessAction) {
    const caller = holderKey ?? Keypair.generate();
    void run(() => settleIxs(program(), v, action, relayerKey(), caller.publicKey), [caller]);
  }

  return (
    <div className="panel" aria-live="polite">
      {state === "card-taken" ? <p className="warn">{t("panel.taken")}</p> : null}
      {state === "none" && !v.payout && v.warranty.status < 2 ? <p className="note">{t("panel.readOnly")}</p> : null}
      {state === "card-unactivated" ? (
        <div className="panel-block">
          <p>{t("panel.unactivated")}</p>
          <button type="button" className="button" disabled={busy || !relayer} onClick={activate}>
            {t("panel.activate")}
          </button>
        </div>
      ) : null}
      {state === "holder" ? <p className="note">{t("panel.holder")}</p> : null}
      {fresh ? (
        <div className="panel-block saved-card">
          <p>{t("panel.saveCard")}</p>
          <input className="mono" readOnly value={fresh} aria-label={t("panel.cardLink")} onFocus={(e) => e.currentTarget.select()} />
        </div>
      ) : null}

      {showCountdown && v.next ? (
        <p className="countdown">
          {fill(t("panel.countdown"), { left: clock(left) })}
        </p>
      ) : null}
      {due ? (
        <div className="panel-block">
          <p>{t(`settle.${due}.body` as MessageKey)}</p>
          <button type="button" className="button" disabled={busy || !relayer} onClick={() => settle(due)}>
            {t(`settle.${due}.button` as MessageKey)}
          </button>
        </div>
      ) : null}

      {holderKey && actions.includes("confirmResolved") ? (
        <button type="button" className="button" disabled={busy || !relayer} onClick={() => void run(() => holderClaimIxs(program(), v, holderKey.publicKey, "confirmResolved"), [holderKey])}>
          {t("panel.confirm")}
        </button>
      ) : null}
      {holderKey && actions.includes("escalate") ? (
        <button type="button" className="button button-quiet" disabled={busy || !relayer} onClick={() => void run(() => holderClaimIxs(program(), v, holderKey.publicKey, "escalate"), [holderKey])}>
          {t("panel.escalate")}
        </button>
      ) : null}
      {holderKey && state === "holder" && actions.includes("fileClaim") ? (
        <ClaimForm
          t={t}
          issueTypes={s.issueTypes}
          maxChars={s.claimMaxChars}
          busy={busy || !relayer}
          onSubmit={(issue, text) => void run(() => fileClaimIxs(program(), v, relayerKey(), holderKey.publicKey, evidenceHash(issue, text)), [holderKey])}
        />
      ) : null}
      {state === "holder" && stored && balance !== null && balance > 0n ? (
        <SendForm
          t={t}
          balance={formatUnits(balance, v.decimals)}
          currency={s.currency}
          decimals={v.decimals}
          busy={busy || !relayer}
          onSubmit={(to, amount) =>
            void run(async () => sendIxs(v, relayerKey(), stored.publicKey, to, amount), [stored], () => void refreshBalance(stored.publicKey))
          }
        />
      ) : null}

      {!relayer ? <p className="warn">{t("error.relayer_unavailable")}</p> : null}
      {busy ? <p className="note">{t("panel.sending")}</p> : null}
      {error ? <p className="warn" role="alert">{t(`error.${error}` as MessageKey)}</p> : null}
      {done ? (
        <p className="ok">
          {t("panel.done")}{" "}
          <a href={s.explorerTx.replace("{sig}", done)} target="_blank" rel="noopener noreferrer">
            {t("timeline.record")}
          </a>
        </p>
      ) : null}
    </div>
  );
}
