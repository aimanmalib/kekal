// Reading the warranty again from /demo. Pure apart from the fetch it is given: the scene decides what to show.
import type { WarrantyView } from "../warranty/view";

export type ReadOutcome = { ok: true; view: WarrantyView } | { ok: false; retryAfterMs: number | null };

/** Retry-After as seconds (the server sends seconds; an HTTP date is not used here) in ms, or null. */
export function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const secs = Number(header.trim());
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : null;
}

/** GET /api/warranty/[pda]. Never throws: any failure comes back as ok: false, with the server's Retry-After if any. */
export async function readView(address: string, fetchImpl: typeof fetch = fetch): Promise<ReadOutcome> {
  try {
    const res = await fetchImpl(`/api/warranty/${address}`, { cache: "no-store" });
    if (!res.ok) return { ok: false, retryAfterMs: retryAfterMs(res.headers.get("retry-after")) };
    return { ok: true, view: (await res.json()) as WarrantyView };
  } catch {
    return { ok: false, retryAfterMs: null };
  }
}

/**
 * The wait before re-read number `attempt` (0 = the first re-read after a failed read): the configured back-off
 * (recheckMs), then pollMs for as long as the scene stays open; never shorter than the server asked for.
 */
export function recheckDelay(attempt: number, retryAfter: number | null, recheckMs: readonly number[], pollMs: number): number {
  return Math.max(recheckMs[attempt] ?? pollMs, retryAfter ?? 0);
}

/** What the scene shows below its steps. While a re-read is pending, the last view is out of date: no form, no button. */
export type ScenePanel = "checking" | "claim" | "wait" | "due" | "paid" | null;
export function scenePanel(phaseKind: string | null, checking: boolean): ScenePanel {
  if (checking) return "checking";
  return phaseKind === "claim" || phaseKind === "wait" || phaseKind === "due" || phaseKind === "paid" ? phaseKind : null;
}
