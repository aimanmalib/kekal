// The HTTP answer for a warranty read (GET /api/warranty/[pda]). Pure, so the status mapping is tested directly.
import type { ReadResult } from "./read";

const STATUS = { bad_address: 400, not_found: 404, network: 502 } as const;
const noStore = { "cache-control": "no-store" };

/** 200 with the view; 503 + Retry-After when the RPC kept answering 429; otherwise 400 / 404 / 502. */
export function readResponse(r: ReadResult): Response {
  if (r.ok) return Response.json(r.view, { headers: noStore });
  if (r.reason === "network" && r.retryAfterSecs !== undefined) {
    return Response.json({ error: "busy" }, { status: 503, headers: { ...noStore, "retry-after": String(r.retryAfterSecs) } });
  }
  return Response.json({ error: r.reason }, { status: STATUS[r.reason], headers: noStore });
}
