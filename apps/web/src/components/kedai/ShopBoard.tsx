"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { statusKey, warrantyPda } from "@kekal/sdk";
import { fill, translator, type Lang, type MessageKey } from "@/lib/i18n";
import { canRespond, type ShopBoard as Board } from "@/lib/shop/board";
import type { CardFacts } from "@/lib/shop/card-content";
import { depositIxs, heartbeatIxs, issueIxs, openShopIxs, ownerTokenAccount, respondIxs, withdrawIxs } from "@/lib/shop/actions";
import { accountKey, sendWithWallet } from "@/lib/wallet/standard";
import { ActionError, cardLink, keypairFromSeed, newSeed, tokenBalance } from "@/lib/warranty/client";
import { clientProgram } from "@/lib/warranty/program";
import { formatDate, formatDateTime, formatUnits, relativeTime } from "@/lib/warranty/format";
import { FundsForm, IssueForm, RespondForm, type IssueValues } from "./ShopForms";
import { IssuedCard, type CardSize } from "./IssuedCard";
import { WalletPicker } from "./WalletPicker";
import { useWallet } from "./useWallet";

export interface BoardSettings {
  chain: string;
  /** False while the program is not on the cluster: the no-wallet demo is closed, so it is not offered. */
  demoOpen: boolean;
  currency: string;
  mints: { name: string; address: string }[];
  windows: { responseSecs: number; repairSecs: number; disputeSecs: number; heartbeatSecs: number; graceSecs: number };
  termMonths: number[];
  defaultTermMonths: number;
  secsPerMonth: number;
  reserve: string;
  promise: { en: string; ms: string };
  max: { product: number; serial: number; promise: number; reason: number };
  pollMs: number;
  confirmPollMs: number;
  confirmTimeoutMs: number;
  keyFragment: string;
  explorerTx: string;
  card: CardSize;
}

const KNOWN = new Set(["wallet_declined", "wallet_no_account", "network", "send_failed", "failed_on_chain", "not_confirmed", "rate_ip"]);

export function ShopBoard({ lang, settings: s }: { lang: Lang; settings: BoardSettings }) {
  const t = translator(lang);
  const { wallets, connected, connect, disconnect, failed } = useWallet(s.chain);
  const [board, setBoard] = useState<Board | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [held, setHeld] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; detail?: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ facts: CardFacts; termsKept: boolean } | null>(null);
  const [mint, setMint] = useState(s.mints[0]?.address ?? "");
  const owner = connected ? accountKey(connected.account) : null;
  const ownerText = owner?.toBase58() ?? null;

  const load = useCallback(async () => {
    if (!ownerText) return;
    try {
      const res = await fetch(`/api/shop/${ownerText}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const b = (await res.json()) as Board;
      setBoard(b);
      setLoadError(false);
      if (b.shop) setHeld(await tokenBalance(ownerTokenAccount(b.shop.mint, new PublicKey(ownerText)).toBase58()).catch(() => null));
    } catch {
      setLoadError(true);
    }
  }, [ownerText]);

  useEffect(() => {
    setBoard(null);
    setIssued(null);
    void load();
    if (!ownerText) return;
    const id = window.setInterval(() => void load(), s.pollMs);
    return () => window.clearInterval(id);
  }, [ownerText, load, s.pollMs]);

  async function run(build: () => Promise<{ ixs: TransactionInstruction[]; after?: () => Promise<void> }>) {
    if (!connected) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { ixs, after } = await build();
      const sig = await sendWithWallet(connected.wallet, connected.account, ixs, { chain: s.chain, pollMs: s.confirmPollMs, timeoutMs: s.confirmTimeoutMs });
      await after?.();
      setDone(sig);
      await load();
    } catch (e) {
      const code = e instanceof ActionError ? e.code : "generic";
      setError({ code: KNOWN.has(code) ? code : "generic" });
    } finally {
      setBusy(false);
    }
  }

  const program = () => clientProgram(board!.programId);

  function issue(v: IssueValues) {
    if (!board?.shop || !owner) return;
    const shop = board.shop;
    const seed = newSeed();
    const warrantyId = BigInt(shop.nextWarrantyId);
    const termSecs = v.months * s.secsPerMonth;
    const input = { product: v.product, serial: v.serial, promise: v.promise, reserve: v.reserve.toString(), termSecs, holder: keypairFromSeed(seed).publicKey, warrantyId };
    void run(async () => {
      const built = await issueIxs(program(), owner, input);
      return {
        ixs: built.ixs,
        after: async () => {
          const pda = warrantyPda(new PublicKey(board.programId), new PublicKey(shop.address), warrantyId).toBase58();
          const kept = await fetch("/api/terms", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ warranty: pda, terms: built.termsJson }),
          }).then((r) => r.ok, () => false);
          setIssued({
            termsKept: kept,
            facts: {
              link: cardLink(window.location.origin, pda, s.keyFragment, seed),
              host: window.location.host,
              warrantyId: warrantyId.toString(),
              product: input.product.trim(),
              serial: input.serial.trim(),
              reserve: input.reserve,
              decimals: board.decimals,
              currency: s.currency,
              expiresAt: (board.chainNow ?? Math.floor(Date.now() / 1000)) + termSecs,
              promise: { en: v.promise.en.trim(), ms: v.promise.ms.trim() },
            },
          });
        },
      };
    });
  }

  if (!connected || !owner) {
    return <WalletPicker t={t} wallets={wallets} failed={failed} demoOpen={s.demoOpen} onPick={(w) => void connect(w)} />;
  }
  const now = board?.chainNow ?? Math.floor(Date.now() / 1000);
  const shop = board?.shop ?? null;
  const fmt = (v: string) => `${formatUnits(v, board?.decimals ?? 0)} ${s.currency}`;

  return (
    <div className="board" aria-busy={busy}>
      <p className="board-who">
        {fill(t("wallet.connected"), { name: connected.wallet.name })} <span className="mono">{ownerText}</span>{" "}
        <button type="button" className="button button-quiet" onClick={() => void disconnect()}>
          {t("wallet.disconnect")}
        </button>
      </p>
      {loadError ? <p className="warn">{t("error.network")}</p> : null}
      {!board ? <p className="note">{t("kedai.loading")}</p> : null}

      {board && !shop ? (
        <section className="board-section">
          <h2>{t("kedai.open.heading")}</h2>
          <p>{t("kedai.open.body")}</p>
          {s.mints.length > 1 ? (
            <label className="form">
              <span>{t("kedai.open.mint")}</span>
              <select value={mint} onChange={(e) => setMint(e.target.value)}>
                {s.mints.map((m) => (
                  <option key={m.address} value={m.address}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {s.mints.length === 0 ? <p className="warn">{t("kedai.open.noMint")}</p> : null}
          <button type="button" className="button" disabled={busy || !mint} onClick={() => void run(async () => ({ ixs: await openShopIxs(program(), owner, mint, s.windows) }))}>
            {t("kedai.open.submit")}
          </button>
        </section>
      ) : null}

      {shop ? (
        <>
          <p className="shop-link">
            <a href={`/kedai/${board!.owner}`}>{t("shopPage.boardLink")}</a> <span className="note">{t("shopPage.boardLinkNote")}</span>
          </p>
          <section className="board-section board-reserve">
            <h2>{t("kedai.reserve.heading")}</h2>
            <dl className="figures">
              <div>
                <dt>{t("kedai.reserve.free")}</dt>
                <dd className="num">{fmt(shop.free)}</dd>
              </div>
              <div>
                <dt>{t("kedai.reserve.locked")}</dt>
                <dd className="num">{fmt(shop.locked)}</dd>
              </div>
              <div>
                <dt>{t("kedai.reserve.wallet")}</dt>
                <dd className="num">{held === null ? "–" : fmt(held.toString())}</dd>
              </div>
            </dl>
            <FundsForm
              t={t}
              decimals={board!.decimals}
              currency={s.currency}
              busy={busy}
              onDeposit={(a) => void run(async () => ({ ixs: await depositIxs(program(), owner, shop.mint, a) }))}
              onWithdraw={(a) => void run(async () => ({ ixs: await withdrawIxs(program(), owner, shop.mint, a) }))}
            />
          </section>

          <section className="board-section">
            <h2>{t("kedai.alive.heading")}</h2>
            <p>
              {t(statusKey.shop(shop.status) as MessageKey)}.{" "}
              {fill(t("kedai.alive.lastSeen"), { when: relativeTime(shop.lastSeen, now, lang) })}{" "}
              {fill(t("kedai.alive.silentAt"), { when: formatDateTime(shop.silentAt, lang) })}
            </p>
            <button type="button" className="button" disabled={busy} onClick={() => void run(async () => ({ ixs: await heartbeatIxs(program(), owner) }))}>
              {t("kedai.alive.submit")}
            </button>
          </section>

          <section className="board-section">
            <h2>{t("kedai.claims.heading")}</h2>
            {board!.claims.length === 0 ? <p className="note">{t("kedai.claims.none")}</p> : null}
            <ul className="claim-list">
              {board!.claims.map((c) => (
                <li key={c.address}>
                  <p>
                    {fill(t("kedai.claims.row"), { id: c.warrantyId, filed: formatDateTime(c.filedAt, lang) })}{" "}
                    <strong>{t(statusKey.claim(c.status) as MessageKey)}</strong>
                    {c.deadline ? ` · ${fill(t("kedai.claims.deadline"), { when: formatDateTime(c.deadline, lang) })}` : null}{" "}
                    <a href={`/w/${c.warranty}`}>{t("kedai.claims.open")}</a>
                  </p>
                  {canRespond(c, now) ? (
                    <RespondForm
                      t={t}
                      busy={busy}
                      maxChars={s.max.reason}
                      onRespond={(accept, reason) => void run(async () => ({ ixs: await respondIxs(program(), owner, { warranty: c.warranty, claim: c.address, accept, reason }) }))}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="board-section">
            <h2>{t("kedai.issue.heading")}</h2>
            {issued ? <IssuedCard t={t} facts={issued.facts} size={s.card} termsKept={issued.termsKept} /> : null}
            <IssueForm
              key={shop.nextWarrantyId}
              t={t}
              decimals={board!.decimals}
              currency={s.currency}
              busy={busy}
              defaults={{ reserve: s.reserve, months: s.defaultTermMonths, promise: s.promise }}
              termMonths={s.termMonths}
              max={s.max}
              onSubmit={issue}
            />
          </section>

          <section className="board-section">
            <h2>{fill(t("kedai.cards.heading"), { n: board!.warranties.length })}</h2>
            <ul className="card-list">
              {board!.warranties.map((w) => (
                <li key={w.address}>
                  <a href={`/w/${w.address}`}>{fill(t("kedai.cards.row"), { id: w.id })}</a> <span className="num">{fmt(w.reserve)}</span> ·{" "}
                  {t(`kedai.cardStatus.${statusKey.warranty(w.status).split(".").pop()}` as MessageKey)} · {fill(t("kedai.cards.until"), { when: formatDate(w.expiresAt, lang) })}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {busy ? <p className="note">{t("kedai.sending")}</p> : null}
      {error ? <p className="warn" role="alert">{t(`kedai.error.${error.code}` as MessageKey)}</p> : null}
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
