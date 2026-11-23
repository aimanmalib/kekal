// Seller and arbiter wallets through the Wallet Standard (Phantom, Solflare, Backpack and others register themselves).
// The wallet signs; the signed transaction goes to POST /api/submit, so the browser never talks to a public RPC.
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { ActionError, rpc, toBase64, waitConfirmed } from "../warranty/client";

const CONNECT = "standard:connect";
const DISCONNECT = "standard:disconnect";
const SIGN_TX = "solana:signTransaction";

type ConnectFeature = { [CONNECT]: { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> } };
type DisconnectFeature = { [DISCONNECT]: { disconnect(): Promise<void> } };
type SignFeature = {
  [SIGN_TX]: { signTransaction(...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<readonly { signedTransaction: Uint8Array }[]> };
};

/** Wallets that can connect and sign a transaction for `chain`. */
export function usableWallets(chain: string): Wallet[] {
  return getWallets()
    .get()
    .filter((w) => CONNECT in w.features && SIGN_TX in w.features && (w.chains.length === 0 || w.chains.includes(chain as never)));
}

/** Calls back whenever a wallet registers or leaves; returns the unsubscribe function. */
export function onWalletsChanged(cb: () => void): () => void {
  const api = getWallets();
  const offRegister = api.on("register", cb);
  const offUnregister = api.on("unregister", cb);
  return () => {
    offRegister();
    offUnregister();
  };
}

export async function connectWallet(wallet: Wallet): Promise<WalletAccount> {
  const { accounts } = await (wallet.features as unknown as ConnectFeature)[CONNECT].connect();
  const account = accounts[0] ?? wallet.accounts[0];
  if (!account) throw new ActionError("wallet_no_account");
  return account;
}

export async function disconnectWallet(wallet: Wallet): Promise<void> {
  const f = (wallet.features as unknown as Partial<DisconnectFeature>)[DISCONNECT];
  await f?.disconnect().catch(() => undefined);
}

export const accountKey = (a: WalletAccount) => new PublicKey(a.address);

export interface WalletSendOpts {
  chain: string;
  pollMs: number;
  timeoutMs: number;
}

/** The wallet pays the fee and signs; the server only broadcasts. Returns the signature once confirmed. */
export async function sendWithWallet(wallet: Wallet, account: WalletAccount, ixs: TransactionInstruction[], opts: WalletSendOpts): Promise<string> {
  const { value } = await rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const message = new TransactionMessage({ payerKey: accountKey(account), recentBlockhash: value.blockhash, instructions: ixs }).compileToV0Message();
  const unsigned = new VersionedTransaction(message).serialize();
  let signed: Uint8Array;
  try {
    const [out] = await (wallet.features as unknown as SignFeature)[SIGN_TX].signTransaction({ account, transaction: unsigned, chain: opts.chain });
    if (!out) throw new Error("no output");
    signed = out.signedTransaction;
  } catch {
    throw new ActionError("wallet_declined");
  }
  let res: Response;
  try {
    res = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx: toBase64(signed) }),
    });
  } catch {
    throw new ActionError("network");
  }
  const body = (await res.json().catch(() => ({}))) as { signature?: string; error?: string; detail?: string };
  if (!res.ok || !body.signature) throw new ActionError(body.error ?? "send_failed");
  return waitConfirmed(body.signature, opts);
}
