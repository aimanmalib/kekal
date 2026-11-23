// JSON-RPC failover shared by /api/rpc, the relayer, the demo routes and the keeper.
import { Connection } from "@solana/web3.js";

export interface Upstream {
  status: number;
  body: string;
  url: string;
}

export interface FailoverOptions {
  urls: string[];
  timeoutMs: number;
  retryStatuses: number[];
  fetchImpl?: typeof fetch;
}

/** Tries each URL in order; moves on after a network error, a timeout or a retryable status. */
export async function forwardWithFailover(payload: string, opts: FailoverOptions): Promise<Upstream> {
  const doFetch = opts.fetchImpl ?? fetch;
  let last: Upstream | undefined;
  for (const url of opts.urls) {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      const body = await res.text();
      last = { status: res.status, body, url };
      if (!opts.retryStatuses.includes(res.status)) return last;
    } catch {
      // network error or timeout: try the next endpoint, keep any earlier answer
    }
  }
  if (last) return last;
  throw new Error("all RPC endpoints failed");
}

/**
 * A web3.js Connection whose HTTP calls go through forwardWithFailover, so every read and send tries the
 * endpoints in order. Websocket subscriptions are not used by server code (confirmation polls over HTTP).
 */
export function failoverConnection(opts: FailoverOptions, commitment: "confirmed" | "finalized" = "confirmed"): Connection {
  const first = opts.urls[0];
  if (!first) throw new Error("no RPC URLs");
  const fetchThrough = async (_input: unknown, init?: { body?: unknown }): Promise<Response> => {
    const up = await forwardWithFailover(String(init?.body ?? ""), opts);
    return new Response(up.body, { status: up.status, headers: { "content-type": "application/json" } });
  };
  return new Connection(first, { commitment, fetch: fetchThrough as unknown as typeof fetch, disableRetryOnRateLimit: true });
}
