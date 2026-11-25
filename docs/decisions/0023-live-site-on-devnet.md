# ADR 0023: The live site on devnet

- Status: accepted
- Date: 2026-11-25

## Context

The program has been on devnet since the deploy recorded in `docs/MEASURED.md`, but the live site still ran with `deployed: false`, so the
no-wallet demo and every route that sends a transaction answered `program_not_deployed`. A demo on one public RPC
endpoint fails when that endpoint rate-limits or goes down.

## Decision

- **Three public devnet endpoints, in order** (`config/app.json` `clusters.devnet.rpcUrls`): the Solana Labs endpoint,
  then two public endpoints from other operators. Each was checked to answer `getLatestBlockhash`, `getAccountInfo` on
  the program and `getSignatureStatuses` without an API key before it was listed. `failoverConnection` tries them in
  order on timeouts and on the configured retry statuses. A web test keeps at least two distinct HTTPS hosts in the list.
  `RPC_URLS` still overrides the list for a host with its own endpoint.
- **`deployed: true` for devnet.** The banner, the closed demo and the 503 gate all read this one value.
- **The keeper runs** (compose profile `devnet`). It heartbeats the shared demo shop and sends the due permissionless
  steps for the demo warranties, paid by the relayer key.
- **The container gets only the keys it signs with**: the shared demo seller, the arbiter and the relayer, in a host
  folder mounted read-only. The deploy key and the mint key stay off the web host's container.
- **`/contoh` comes from a devnet run** (`pnpm lifecycle --cluster devnet --out config/examples.json`), so every example
  links to a real devnet transaction.

## Consequences

Public endpoints can still all be slow at once; the demo then shows its own error and the examples page still works,
because it reads a file. Moving to a keyed endpoint is a config change (`RPC_URLS`), not a code change.
