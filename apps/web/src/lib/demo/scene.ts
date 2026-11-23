// What /demo shows for one scene, from the warranty as the chain sees it. Pure: no network, no clock reads.
import { WarrantyStatus, type PermissionlessAction } from "@kekal/sdk";
import type { MessageKey } from "../i18n";
import type { WarrantyView } from "../warranty/view";

/** "silent": the shared demo shop never answers a claim (path B). "closed": a throwaway shop stops its heartbeat (path C). */
export type SceneKind = "silent" | "closed";

export const SCENES: readonly SceneKind[] = ["silent", "closed"];

/** The demo route that issues the warranty for each scene. */
export const SCENE_ROUTE: Record<SceneKind, string> = {
  silent: "/api/demo/session",
  closed: "/api/demo/dying-shop",
};

export type Phase =
  | { kind: "claim" }
  | { kind: "wait"; action: PermissionlessAction; dueAt: number }
  | { kind: "due"; action: PermissionlessAction }
  | { kind: "paid"; amount: string; statusKey: string }
  | { kind: "idle" };

/**
 * The visitor's next move. A payout ends the scene; in the "silent" scene an untouched warranty waits for a claim;
 * otherwise the next step anyone may send is either counting down or ready (the keeper may also send it first).
 */
export function scenePhase(kind: SceneKind, v: WarrantyView, now: number): Phase {
  if (v.payout) return { kind: "paid", amount: v.payout.amount, statusKey: v.payout.statusKey };
  if (kind === "silent" && v.warranty.status === WarrantyStatus.Active && v.warranty.claimCount === 0) return { kind: "claim" };
  if (!v.next || v.next.action === "releaseExpired") return { kind: "idle" };
  return now >= v.next.dueAt ? { kind: "due", action: v.next.action } : { kind: "wait", action: v.next.action, dueAt: v.next.dueAt };
}

/** Most telling event first: one transaction can carry several (a payout also changes the claim status). */
const PRIMARY = ["ReservePaid", "ShopDeclaredDormant", "ClaimResponded", "ClaimFiled", "HolderTransferred", "WarrantyIssued"] as const;
type PrimaryEvent = (typeof PRIMARY)[number];

export interface SceneStep {
  signature: string;
  explorer: string;
  event: PrimaryEvent;
  /** Short name of what happened, and the one sentence that explains it. */
  label: MessageKey;
  why: MessageKey;
}

/** The scene's transactions, oldest first, each with the sentence that explains it. Failed and unlabelled ones are left out. */
export function sceneSteps(v: WarrantyView): SceneStep[] {
  const out: SceneStep[] = [];
  for (const e of [...v.timeline].reverse()) {
    if (e.failed) continue;
    const event = PRIMARY.find((p) => e.events.includes(p));
    if (!event) continue;
    out.push({ signature: e.signature, explorer: e.explorer, event, label: `event.${event}`, why: `demo.why.${event}` });
  }
  return out;
}

/** What this browser remembers between visits: the warranty address of each scene it started. */
export type Remembered = Partial<Record<SceneKind, string>>;

export function readRemembered(raw: string | null): Remembered {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Remembered = {};
    for (const k of SCENES) {
      const v = parsed[k];
      if (typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
