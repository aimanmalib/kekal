// Values the browser tests read: config/e2e.json, the locale files and what scripts/e2e.sh prepared (E2E_FIXTURES, E2E_KEYS).
// UI text comes from locales/*.json, so a copy edit does not break a test.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

export interface E2eProject {
  name: string;
  browser: "chromium" | "webkit";
  device: string;
  wallet: number;
  lang: Lang;
}

export interface E2eConfig {
  port: number;
  healthTimeoutSecs: number;
  testTimeoutSecs: number;
  actionTimeoutSecs: number;
  overflowWidths: number[];
  overflowPages: string[];
  projects: E2eProject[];
  seller: { deposit: string; product: string; serial: string };
  claimText: string;
  rejectNote: string;
}

export const e2e = readJson<E2eConfig>(join(root, "config", "e2e.json"));

interface AppLocales {
  web: { locales: { supported: string[]; cookie: string } };
}
const app = readJson<AppLocales>(join(root, "config", "app.json"));
export const LANGS = app.web.locales.supported as Lang[];
export const LANG_COOKIE = app.web.locales.cookie;
export type Lang = "en" | "ms";

const dictionaries = Object.fromEntries(
  LANGS.map((l) => [l, readJson<Record<string, string>>(join(root, "locales", `${l}.json`))]),
) as Record<Lang, Record<string, string>>;

/** The text of a locale key; throws on a missing key so a renamed key fails loudly. */
export function text(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const raw = dictionaries[lang][key];
  if (raw === undefined) throw new Error(`locale ${lang}: no key ${key}`);
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** A locale text as a whole-string pattern; unfilled {placeholders} match anything. */
export function pattern(lang: Lang, key: string, vars: Record<string, string | number> = {}): RegExp {
  const parts = text(lang, key, vars).split(/\{\w+\}/);
  return new RegExp(`^${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+")}$`);
}

export interface Fixtures {
  mint: string;
  programId: string;
  /** Owner of the demo shop seeded with the cards: its public page is /kedai/<shopOwner>. */
  shopOwner: string;
  wallets: string[];
  cards: { warranty: string; fragment: string }[];
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; run the tests through scripts/e2e.sh`);
  return v;
}

export const fixtures = (): Fixtures => readJson<Fixtures>(required("E2E_FIXTURES"));

/** A 64-byte secret key written by scripts/page-fixtures.ts (keys/<name>.json). */
export const secretKey = (name: string): Uint8Array => Uint8Array.from(readJson<number[]>(join(required("E2E_KEYS"), `${name}.json`)));

export const walletKeyName = (index: number): string => (index === 0 ? "test-wallet" : `test-wallet-${index}`);

/** Where screenshots go: E2E_SHOTS when given, else the test's own output folder. */
export const shotDir = (): string | null => process.env.E2E_SHOTS || null;

/** Where screen recordings go: E2E_VIDEO when given (one .webm per page, named after the project and the step), else none.
 * E2E_VIDEO_SCALE (default 2) multiplies the viewport for the recorded frame size in WebKit. Used to film the demo video. */
export const videoDir = (): string | null => process.env.E2E_VIDEO || null;
export const videoScale = (): number => Number(process.env.E2E_VIDEO_SCALE || 2);

/** The Wallet Standard chain the test wallet offers: the local validator unless E2E_WALLET_CHAIN names another (e.g.
 * "solana:devnet" when filming the shop board on the public site with a devnet test key in E2E_KEYS). */
export const walletChain = (): string => process.env.E2E_WALLET_CHAIN || "solana:localnet";
