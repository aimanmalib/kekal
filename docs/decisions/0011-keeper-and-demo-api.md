# ADR 0011: Keeper, no-wallet demo API and demo seeding

- Status: accepted
- Date: 2026-11-23

## Context

The spec needs a process that sends the permissionless instructions (15 to 20) when they fall due, a guided demo that
needs no wallet (`/api/demo/session`, `seller-action`, `arbiter-action`, `dying-shop`), and one command that recreates
the demo state after a devnet reset (risk R4). The web app and the keeper run as two services from one image and share
the off-chain store.

## Decision

- **Shared server package.** The store (SQLite behind the `DataStore` interface), key loading, cluster settings, RPC
  failover and the demo chain steps move to `packages/server`, used by the web app, the keeper and the scripts.
  Server-side web3.js connections send every HTTP call through the same endpoint failover as `/api/rpc`, and
  confirmation polls signature status over HTTP, so no websocket endpoint is needed.
- **Keeper pass** (`apps/keeper`): every `keeper.intervalSecs` it (1) heartbeats the shops of `heartbeatRoles` at most
  once per `heartbeatEverySecs`, (2) declares every lapsed shop dormant, (3) re-reads accounts and sends each due step,
  oldest first, capped per pass. Warranties are read with `getProgramAccounts` filtered by discriminator and status;
  the byte offsets come from the IDL, and a test checks them against an encoded account. Program errors that mean
  someone already moved the account (for example `WarrantyNotActive`) are logged as skipped; any other failure is
  retried on the next pass. The pass writes `keeper_last_run` for `/api/health`. Planning is a pure function and the
  pass takes its reads, clock and sender as arguments, so both are tested without a cluster.
- **Demo routes.** The server signs as the shared demo seller (and funds dying shops from it) and as the demo arbiter.
  Each issued warranty is recorded in `demo_sessions` (public keys only); the seller and arbiter actions refuse any
  warranty a demo route did not issue, and the shop toggle is refused on dying-shop warranties. Limits are fixed windows
  per caller IP and per day in `web.demo`. The shared shop's heartbeat rides in the same transaction as each demo issue.
- **Dying shop.** A fresh owner key is generated per request, funded with `demo.dyingShop.sol` and one reserve of kUSD
  from the shared seller, creates a shop with a short heartbeat and no grace, issues one warranty, and is then dropped.
  Nobody can heartbeat that shop again, so path C completes on its own.
- **Seeding** (`scripts/seed-demo.ts`): Config if missing, the kUSD mint, the shared shop (deposit plus the seller float
  that funds dying shops), and the showcase shop with realistic windows and a few cards. It only tops up when run again.
  A missing showcase owner key is created in the keys folder (mode 0600).
- **Shop windows are fixed at creation** and lifecycle and the demo use the same seller key, so the devnet lifecycle
  shop windows now equal the shared demo shop windows; a config test enforces it.

## Consequences

- If the keeper is down longer than the shared shop's heartbeat plus grace, anyone may declare that shop dormant and it
  never reopens. Recovery is a new key for `demo.sharedShop.role` and a `seed-demo` run; the security notes list keeper
  downtime as a known limit.
- Each dying shop leaves its rent in accounts nobody can close (no `close` instruction by design), about
  `demo.dyingShop.sol` per request; `web.demo.dyingShopsPerDay` caps the daily cost.
- The demo shop answers in seconds on purpose; the showcase shop shows realistic windows.
- `scripts/demo-check.ts` runs the demo steps and two keeper passes against a local validator
  (`LOCALNET_SCRIPT=demo-check.ts bash scripts/localnet.sh`); the test gate runs it with `KEKAL_LIFECYCLE=1`.
