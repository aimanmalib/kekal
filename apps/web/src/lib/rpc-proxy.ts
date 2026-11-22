// Policy and failover for POST /api/rpc. Pure functions; the route handler only wires them to Request/Response.

export interface RpcPolicy {
  allowedMethods: string[];
  programScopedMethods: string[];
  programId: string;
  maxBodyBytes: number;
  maxBatch: number;
}

export interface RpcCall {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown[];
}

export type Checked = { ok: true; batch: boolean; calls: RpcCall[] } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): Checked => ({ ok: false, status, error });

function checkCall(raw: unknown, policy: RpcPolicy): RpcCall | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "request must be a JSON-RPC object";
  const c = raw as Record<string, unknown>;
  if (c.jsonrpc !== "2.0") return 'jsonrpc must be "2.0"';
  if (typeof c.method !== "string") return "method must be a string";
  if (!policy.allowedMethods.includes(c.method)) return `method not allowed: ${c.method}`;
  if (c.params !== undefined && !Array.isArray(c.params)) return "params must be an array";
  const id = c.id;
  if (!(id === null || id === undefined || typeof id === "string" || typeof id === "number")) return "id must be a string or number";
  if (policy.programScopedMethods.includes(c.method)) {
    const params = (c.params as unknown[] | undefined) ?? [];
    if (params[0] !== policy.programId) return `${c.method} is limited to the Kekal program`;
  }
  return { jsonrpc: "2.0", id: (id as RpcCall["id"]) ?? null, method: c.method, ...(c.params ? { params: c.params as unknown[] } : {}) };
}

export function checkRequest(bodyText: string, policy: RpcPolicy): Checked {
  if (Buffer.byteLength(bodyText, "utf8") > policy.maxBodyBytes) return fail(413, "request body too large");
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return fail(400, "body is not valid JSON");
  }
  const batch = Array.isArray(body);
  const items = batch ? (body as unknown[]) : [body];
  if (items.length === 0) return fail(400, "empty batch");
  if (items.length > policy.maxBatch) return fail(400, `batch larger than ${policy.maxBatch}`);
  const calls: RpcCall[] = [];
  for (const item of items) {
    const r = checkCall(item, policy);
    if (typeof r === "string") return fail(r.startsWith("method not allowed") || r.includes("limited to") ? 403 : 400, r);
    calls.push(r);
  }
  return { ok: true, batch, calls };
}

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
