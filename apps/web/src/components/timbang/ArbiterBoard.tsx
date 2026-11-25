"use client";

import { useCallback, useEffect, useState } from "react";
import { fill, translator, type Lang, type MessageKey } from "@/lib/i18n";
import type { ArbiterBoard as Board, DisputeRow } from "@/lib/shop/board";
import { resolveIxs } from "@/lib/shop/actions";
import { accountKey, sendWithWallet } from "@/lib/wallet/standard";
import { ActionError, clientProgram } from "@/lib/warranty/client";
import { formatDateTime, formatUnits } from "@/lib/warranty/format";
import { WalletPicker } from "../kedai/WalletPicker";
import { useWallet } from "../kedai/useWallet";

export interface ArbiterSettings {
  chain: string;
  /** False while the program is not on the cluster: the no-wallet demo is closed, so it is not offered. */
  demoOpen: boolean;
  currency: string;
  pollMs: number;
  confirmPollMs: number;
  confirmTimeoutMs: number;
  explorerTx: string;
}

const KNOWN = new Set(["wallet_declined", "wallet_no_account", "network", "send_failed", "failed_on_chain", "not_confirmed", "rate_ip"]);

/** Disputed claims of the shops that named the connected wallet as arbiter, with the two possible rulings. */
export function ArbiterBoard({ lang, settings: s }: { lang: Lang; settings: ArbiterSettings }) {
  const t = translator(lang);
  const { wallets, connected, connect, disconnect, failed } = useWallet(s.chain);
  const [board, setBoard] = useState<Board | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const key = connected ? accountKey(connected.account).toBase58() : null;

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const res = await fetch(`/api/arbiter/${key}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setBoard((await res.json()) as Board);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [key]);

  useEffect(() => {
    setBoard(null);
    void load();
    if (!key) return;
    const id = window.setInterval(() => void load(), s.pollMs);
    return () => window.clearInterval(id);
  }, [key, load, s.pollMs]);

  async function rule(d: DisputeRow, buyerWins: boolean) {
    if (!connected || !board) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const ixs = await resolveIxs(clientProgram(board.programId), accountKey(connected.account), d, buyerWins);
      setDone(await sendWithWallet(connected.wallet, connected.account, ixs, { chain: s.chain, pollMs: s.confirmPollMs, timeoutMs: s.confirmTimeoutMs }));
      await load();
    } catch (e) {
      const code = e instanceof ActionError ? e.code : "generic";
      setError(KNOWN.has(code) ? code : "generic");
    } finally {
      setBusy(false);
    }
  }

  if (!connected) return <WalletPicker t={t} wallets={wallets} failed={failed} demoOpen={s.demoOpen} onPick={(w) => void connect(w)} />;
  return (
    <div className="board" aria-busy={busy}>
      <p className="board-who">
        {fill(t("wallet.connected"), { name: connected.wallet.name })} <span className="mono">{key}</span>{" "}
        <button type="button" className="button button-quiet" onClick={() => void disconnect()}>
          {t("wallet.disconnect")}
        </button>
      </p>
      {loadError ? <p className="warn">{t("error.network")}</p> : null}
      {!board ? <p className="note">{t("kedai.loading")}</p> : null}
      {board && board.disputes.length === 0 ? <p className="note">{t("timbang.none")}</p> : null}
      <ul className="claim-list">
        {board?.disputes.map((d) => (
          <li key={d.claim} className="board-section">
            <p>
              {fill(t("timbang.row"), { id: d.warrantyId, amount: `${formatUnits(d.reserve, board.decimals)} ${s.currency}` })}{" "}
              <a href={`/w/${d.warranty}`}>{t("kedai.claims.open")}</a>
            </p>
            <p className="note">
              {fill(t("timbang.escalated"), { when: formatDateTime(d.escalatedAt, lang) })}{" "}
              {fill(t("timbang.stale"), { when: formatDateTime(d.staleAt, lang) })}
            </p>
            <div className="button-row">
              <button type="button" className="button" disabled={busy} onClick={() => void rule(d, true)}>
                {t("timbang.buyerWins")}
              </button>
              <button type="button" className="button button-quiet" disabled={busy} onClick={() => void rule(d, false)}>
                {t("timbang.shopWins")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {busy ? <p className="note">{t("kedai.sending")}</p> : null}
      {error ? <p className="warn" role="alert">{t(`kedai.error.${error}` as MessageKey)}</p> : null}
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
