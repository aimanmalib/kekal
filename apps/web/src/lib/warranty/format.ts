// Display helpers for amounts and times. Locale tags and the ringgit rate come from config/app.json.
import { webConfig } from "../web-config";
import type { Lang } from "../i18n";

/** Base units (string or bigint) to a fixed two-decimal figure, e.g. 25000000 with 6 decimals → "25.00". */
export function formatUnits(base: string | bigint, decimals: number): string {
  const v = BigInt(base);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const scale = 10n ** BigInt(decimals);
  const cents = (abs * 100n + scale / 2n) / scale;
  const s = `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Ringgit estimate at the fixed config rate, rounded to whole ringgit. */
export function estimateLocal(base: string | bigint, decimals: number): string {
  const units = Number(BigInt(base)) / 10 ** decimals;
  return Math.round(units * webConfig.estimate.perUnit).toString();
}

/** Parses a user-typed amount ("12.5") into base units; null when malformed or over the decimals. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(text);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

function tag(lang: Lang): string {
  return (webConfig.locales.intl as Record<string, string>)[lang] ?? lang;
}

export function formatDate(unix: number, lang: Lang): string {
  return new Intl.DateTimeFormat(tag(lang), { day: "numeric", month: "short", year: "numeric" }).format(unix * 1000);
}

export function formatDateTime(unix: number, lang: Lang): string {
  return new Intl.DateTimeFormat(tag(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(unix * 1000);
}

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

/** "2 days ago" / "in 40 seconds", in the page language. */
export function relativeTime(unix: number, now: number, lang: Lang): string {
  const diff = unix - now;
  const abs = Math.abs(diff);
  const [unit, secs] = STEPS.find(([, s]) => abs >= s) ?? ["second", 1];
  return new Intl.RelativeTimeFormat(tag(lang), { numeric: "auto" }).format(Math.round(diff / secs), unit);
}

/** Seconds left as m:ss (or h:mm:ss) for the claim countdown. */
export function clock(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const SPAN_UNITS: [string, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

/** A window length in its largest whole unit, in the page language: 604800 → "7 days", 90 → "90 seconds". */
export function formatSpan(secs: number, lang: Lang): string {
  const [unit, size] = SPAN_UNITS.find(([, s]) => secs >= s && secs % s === 0) ?? ["second", 1];
  return new Intl.NumberFormat(tag(lang), { style: "unit", unit, unitDisplay: "long" }).format(secs / size);
}
