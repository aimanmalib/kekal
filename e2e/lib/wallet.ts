// A Wallet Standard test wallet injected into the page (registers like a browser extension would). Transactions are
// signed in the test process with an ed25519 key from scripts/page-fixtures.ts; the key never enters the page.
import { createPrivateKey, sign } from "node:crypto";
import type { Browser, BrowserContext, BrowserContextOptions } from "@playwright/test";
import { join } from "node:path";
import { LANG_COOKIE, secretKey, videoDir, videoScale, type Lang } from "./env";

export const TEST_WALLET_NAME = "Kekal Test Wallet";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return "1".repeat(zeros) + s;
}

// PKCS#8 wrapper for a raw 32-byte ed25519 seed (RFC 8410).
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

/** Registers the wallet before any page script runs; the page calls window.kekalSign(hex message) for each signature. */
function walletScript({ address, publicKey, name }: { address: string; publicKey: number[]; name: string }): void {
  const pk = new Uint8Array(publicKey);
  const account = { address, publicKey: pk, chains: ["solana:localnet"], features: ["solana:signTransaction"] };
  const signer = (hexMessage: string) => (window as unknown as { kekalSign: (hex: string) => Promise<string> }).kekalSign(hexMessage);
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const wallet = {
    version: "1.0.0",
    name,
    icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>'),
    chains: ["solana:localnet"],
    accounts: [] as (typeof account)[],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; return { accounts: [account] }; } },
      "standard:events": { version: "1.0.0", on: () => () => undefined },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
          const out: { signedTransaction: Uint8Array }[] = [];
          for (const { transaction } of inputs) {
            const tx = new Uint8Array(transaction);
            const signatures = tx[0] ?? 0; // compact-u16 count; below 128 for any Kekal transaction
            const sig = await signer(hex(tx.slice(1 + 64 * signatures)));
            // /kedai transactions are paid by the wallet itself, so its signature is the first one.
            tx.set(sig.match(/../g)!.map((h) => parseInt(h, 16)), 1);
            out.push({ signedTransaction: tx });
          }
          return out;
        },
      },
    },
  };
  const register = ({ register: r }: { register: (w: unknown) => void }) => r(wallet);
  try {
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  } catch {
    // older pages without the event: the app-ready listener below still registers it
  }
  window.addEventListener("wallet-standard:app-ready", ((e: CustomEvent) => register(e.detail)) as EventListener);
}

export interface WalletContext {
  context: BrowserContext;
  address: string;
}

/** A browser context with the language cookie set and, when keyName is given, the test wallet registered. */
export async function newContext(
  browser: Browser,
  { lang, baseURL, keyName, options = {} }: { lang: Lang; baseURL: string; keyName?: string; options?: BrowserContextOptions },
): Promise<WalletContext> {
  const dir = videoDir();
  const viewport = options.viewport ?? { width: 1280, height: 720 };
  // WebKit films at device pixels, so a phone clip can be sharper than its viewport; Chromium films at the viewport size
  // only (a larger frame just adds a grey margin).
  const scale = browser.browserType().name() === "chromium" ? 1 : videoScale();
  const recordVideo = dir
    ? { dir: join(dir, "raw"), size: { width: viewport.width * scale, height: viewport.height * scale } }
    : undefined;
  const context = await browser.newContext({ ...options, baseURL, acceptDownloads: true, recordVideo });
  await context.addCookies([{ name: LANG_COOKIE, value: lang, url: baseURL }]);
  if (!keyName) return { context, address: "" };
  const sk = secretKey(keyName);
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(sk.slice(0, 32))]), format: "der", type: "pkcs8" });
  const publicKey = sk.slice(32);
  const address = base58(publicKey);
  await context.exposeFunction("kekalSign", (hexMessage: string) => sign(null, Buffer.from(hexMessage, "hex"), key).toString("hex"));
  await context.addInitScript(walletScript, { address, publicKey: Array.from(publicKey), name: TEST_WALLET_NAME });
  return { context, address };
}
