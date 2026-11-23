// POST /api/demo/* behind the routes (PRD 4.6): input checks, limits, session bookkeeping. Chain steps are injected.
import { DemoError, type DataStore, type DemoErrorCode, type Issued } from "@kekal/server";
import { PublicKey } from "@solana/web3.js";

export interface DemoOps {
  issue(holder: PublicKey): Promise<Issued>;
  dyingShop(holder: PublicKey): Promise<Issued>;
  respond(warranty: PublicKey, accept: boolean): Promise<string>;
  resolve(warranty: PublicKey, buyerWins: boolean): Promise<string>;
}

export interface DemoLimits {
  sessionsPerIpPerHour: number;
  sessionsPerDay: number;
  dyingShopsPerIpPerHour: number;
  dyingShopsPerDay: number;
  actionsPerIpPerHour: number;
}

export interface DemoDeps {
  store: DataStore;
  ops: DemoOps;
  limits: DemoLimits;
  explorer: (sig: string) => string;
  now: number;
}

export type DemoResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string; detail?: string };

const HOUR = 3600;
const DAY = 86400;

const refuse = (status: number, error: string, detail?: string): DemoResult => ({ ok: false, status, error, ...(detail ? { detail } : {}) });

const CONFLICT: ReadonlySet<DemoErrorCode> = new Set(["no_open_claim", "claim_not_pending", "claim_not_disputed", "not_demo_shop", "wrong_arbiter"]);

function chainFailure(e: unknown): DemoResult {
  if (e instanceof DemoError) return CONFLICT.has(e.code) ? refuse(409, e.code) : refuse(503, e.code);
  return refuse(502, "send_failed", (e as Error).message.slice(0, 300));
}

function pubkeyField(body: unknown, field: string, onCurve: boolean): PublicKey | null {
  const raw = (body as Record<string, unknown> | null)?.[field];
  if (typeof raw !== "string" || raw.length < 32 || raw.length > 44) return null;
  try {
    const k = new PublicKey(raw);
    return onCurve && !PublicKey.isOnCurve(k.toBytes()) ? null : k;
  } catch {
    return null;
  }
}

function boolField(body: unknown, field: string): boolean | null {
  const v = (body as Record<string, unknown> | null)?.[field];
  return typeof v === "boolean" ? v : null;
}

/** Counts the hit in both buckets (so a refused caller still spends quota); returns the first one over. */
function limited(deps: DemoDeps, kind: string, ip: string, perIpHour: number, perDay: number): DemoResult | null {
  const ipOver = deps.store.hit(`demo:${kind}:ip:${ip}`, HOUR, deps.now) > perIpHour;
  const dayOver = deps.store.hit(`demo:${kind}:day`, DAY, deps.now) > perDay;
  if (ipOver) return refuse(429, "rate_ip");
  if (dayOver) return refuse(429, "rate_global");
  return null;
}

function issuedBody(deps: DemoDeps, issued: Issued, holder: PublicKey) {
  return {
    warranty: issued.warranty.toBase58(),
    shop: issued.shop.toBase58(),
    holder: holder.toBase58(),
    signatures: issued.signatures.map((s) => ({ signature: s, explorer: deps.explorer(s) })),
  };
}

async function issueWith(body: unknown, ip: string, deps: DemoDeps, kind: "shared" | "dying"): Promise<DemoResult> {
  const holder = pubkeyField(body, "holder", true);
  if (!holder) return refuse(400, "bad_holder");
  const l = deps.limits;
  const over =
    kind === "shared"
      ? limited(deps, "session", ip, l.sessionsPerIpPerHour, l.sessionsPerDay)
      : limited(deps, "dying", ip, l.dyingShopsPerIpPerHour, l.dyingShopsPerDay);
  if (over) return over;
  let issued: Issued;
  try {
    issued = kind === "shared" ? await deps.ops.issue(holder) : await deps.ops.dyingShop(holder);
  } catch (e) {
    return chainFailure(e);
  }
  deps.store.putDemoSession({
    warranty: issued.warranty.toBase58(),
    holder: holder.toBase58(),
    shop: issued.shop.toBase58(),
    kind,
    createdAt: deps.now,
  });
  return { ok: true, body: issuedBody(deps, issued, holder) };
}

/** POST /api/demo/session {holder}: the shared demo shop issues a warranty to the visitor's bearer key. */
export const startSession = (body: unknown, ip: string, deps: DemoDeps) => issueWith(body, ip, deps, "shared");

/** POST /api/demo/dying-shop {holder}: a throwaway shop issues one warranty and never heartbeats again (path C). */
export const startDyingShop = (body: unknown, ip: string, deps: DemoDeps) => issueWith(body, ip, deps, "dying");

async function onSession(
  body: unknown,
  ip: string,
  deps: DemoDeps,
  flag: string,
  kinds: ReadonlySet<string>,
  act: (warranty: PublicKey, flagValue: boolean) => Promise<string>,
): Promise<DemoResult> {
  const warranty = pubkeyField(body, "warranty", false);
  const value = boolField(body, flag);
  if (!warranty || value === null) return refuse(400, "bad_request");
  const session = deps.store.getDemoSession(warranty.toBase58());
  if (!session || !kinds.has(session.kind)) return refuse(404, "not_a_demo_warranty");
  if (deps.store.hit(`demo:action:ip:${ip}`, HOUR, deps.now) > deps.limits.actionsPerIpPerHour) return refuse(429, "rate_ip");
  try {
    const signature = await act(warranty, value);
    return { ok: true, body: { signature, explorer: deps.explorer(signature) } };
  } catch (e) {
    return chainFailure(e);
  }
}

const SHARED = new Set(["shared"]);
const ANY = new Set(["shared", "dying"]);

/** POST /api/demo/seller-action {warranty, accept}: "be the shop" for a claim on a demo session warranty. */
export const sellerAction = (body: unknown, ip: string, deps: DemoDeps) =>
  onSession(body, ip, deps, "accept", SHARED, (w, accept) => deps.ops.respond(w, accept));

/** POST /api/demo/arbiter-action {warranty, buyerWins}: the demo arbiter rules on an escalated demo claim. */
export const arbiterAction = (body: unknown, ip: string, deps: DemoDeps) =>
  onSession(body, ip, deps, "buyerWins", ANY, (w, buyerWins) => deps.ops.resolve(w, buyerWins));
