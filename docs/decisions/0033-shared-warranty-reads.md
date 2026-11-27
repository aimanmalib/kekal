# 0033. Shared warranty reads and a demo that keeps checking

Date: 2026-11-27 · Status: accepted

## Context

`/api/warranty/<address>` (followed by `/demo`) and `/w/<address>` read the chain on every request: the warranty, its
shop, its latest claim and the config as separate account reads, the slot and block time, the signature list and one
`getTransaction` per step not yet finalised: seven RPC calls, plus one per recent step, on every read. Eight readers of one warranty at once made
the public RPC endpoints answer 429 to all of them; the route turned that into 502, and `/demo`, whose read after
"Send the claim" failed, quietly showed the claim form again although the claim was on chain and was paid a minute later.

## Decision

- **Server, web only (the program is unchanged).** Reads of one warranty are single-flight: a read already running is
  joined, and a finished read is reused for `web.warrantyPage.readCache.ttlMs` (2 s). Failed reads are never kept.
- Each warranty's shop address and claim count are remembered, so a repeat read fetches the warranty, its shop and the
  latest and next claim in **one `getMultipleAccounts`**, plus **one `getSignaturesForAddress`**: two RPC calls.
  Decoded steps are kept per signature once confirmed (a confirmed transaction does not change). The chain clock offset
  is re-read every `clockSecs` (60 s) and the config every `configSecs` (300 s). A first read of a warranty costs
  one `getAccountInfo` more, plus one `getTransaction` per step not seen before.
- **Rate limits.** When every endpoint answers 429, the read waits a random 150 to 600 ms (`rateRetryMs`) and tries
  once more; still limited, the route answers **503 with `Retry-After`** (`retryAfterSecs`, 3 s) instead of 502.
- **Client.** After a step, a failed read puts the scene in a "checking" state (a status line in both languages)
  that hides the old form and button. It reads again after 1, 2, 4 and 8 s (`web.demoPage.recheckMs`) or the
  server's `Retry-After` if longer, then every `pollMs` for as long as the scene is open.

## Consequences

- Many visitors of one warranty cost the public RPC one read every two seconds; the keeper, which shares the host's
  RPC allowance, is less likely to be rate limited.
- A page may show a state up to two seconds old; deadlines are counted on the chain clock, so a countdown is not affected.
- The cache lives in one web container's memory. More containers would each keep their own (acceptable at this size).
- Undo: revert the commit; the route and page go back to reading on every request.
