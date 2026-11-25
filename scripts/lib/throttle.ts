/**
 * A fetch for public RPC endpoints that rate-limit by IP: requests start at least `minGapMs` apart, and a 429 answer is
 * retried after a growing delay (`retryMs`, doubled each time, up to `maxRetries`). Local validators do not need it.
 */
export interface ThrottleOptions {
  minGapMs: number;
  retryMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function throttledFetch(opts: ThrottleOptions): typeof fetch {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let next = 0;
  const slot = async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + opts.minGapMs;
    if (at > now) await sleep(at - now);
  };
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    for (let attempt = 0; ; attempt++) {
      await slot();
      const res = await doFetch(input, init);
      if (res.status !== 429 || attempt >= opts.maxRetries) return res;
      await sleep(opts.retryMs * 2 ** attempt);
    }
  }) as typeof fetch;
}
