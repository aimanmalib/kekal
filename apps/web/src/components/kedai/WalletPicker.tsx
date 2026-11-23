"use client";

import Link from "next/link";
import type { Wallet } from "@wallet-standard/base";
import type { Translate } from "@/lib/i18n";

interface Props {
  t: Translate;
  wallets: Wallet[];
  failed: boolean;
  onPick: (w: Wallet) => void;
}

/** Lists the wallets this browser offers; without one, says how to get one and points to the no-wallet demo. */
export function WalletPicker({ t, wallets, failed, onPick }: Props) {
  return (
    <div className="panel-block wallet-picker">
      <p>{t("wallet.why")}</p>
      {wallets.length === 0 ? (
        <p className="note">
          {t("wallet.none")} <Link href="/demo">{t("wallet.tryDemo")}</Link>
        </p>
      ) : (
        <ul className="wallet-list">
          {wallets.map((w) => (
            <li key={w.name}>
              <button type="button" className="button button-quiet" onClick={() => onPick(w)}>
                {/* Wallet icons are data: URIs the wallet itself provides. */}
                <img src={w.icon} alt="" width={24} height={24} />
                <span>{w.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed ? <p className="warn" role="alert">{t("wallet.failed")}</p> : null}
    </div>
  );
}
