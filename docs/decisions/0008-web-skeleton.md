# ADR 0008: Web app skeleton, RPC proxy and off-chain store

- Status: accepted
- Date: 2026-11-22

## Context

The web app (PRD 4.5) needs a server that keeps RPC traffic off the browser, a small off-chain store for shop and
claim metadata and rate-limit counters, two languages, and a build that fits a small container next to other services.

## Decision

- **Next.js 16.4 (App Router), React 19.3, TypeScript strict, `output: "standalone"`** in `apps/web`, with the
  monorepo root as the tracing root so the SDK and `config/` are included.
- **Config and text are imported from `config/app.json` and `locales/*.json` at build time.** A change is a commit
  and a redeploy, never a code edit. `KEKAL_CLUSTER`, `RPC_URLS` and `KEKAL_PROGRAM_ID` override per deployment.
- **`POST /api/rpc`** forwards JSON-RPC only for the read methods listed in `web.rpc.allowedMethods`;
  `getProgramAccounts` must name the Kekal program; body size and batch length are capped; unknown fields are dropped.
  It tries each URL in order and moves on after a network error, a timeout or a status in `retryStatuses`.
  `sendTransaction` is never proxied: signed transactions go through the relayer (P2b) with its own checks.
- **Store behind one interface, SQLite first.** `DATA_BACKEND=sqlite` uses Node's built-in `node:sqlite` (no native
  add-on to compile or ship). Schema is plain SQL in `supabase/migrations/`, written in the subset that both SQLite and
  Postgres accept, so the Supabase adapter can apply the same files. Migrations run once each, in name order, in a
  transaction, recorded in `schema_migrations`. The image must ship `supabase/migrations/` (or set
  `KEKAL_MIGRATIONS_DIR`) because the path is resolved at run time.
- **Fonts self-hosted** through `@fontsource` packages; no font CDN.
- **`GET /api/health`** reports cluster, program id, store backend, `keeper_last_run` from the store, live optional
  features and relayer funding (null until the relayer exists); 503 when the store cannot open.

## Consequences

- `node:sqlite` prints an experimental warning on Node 22; it is stable enough for one writer and a few readers.
  Undo: swap the adapter for `better-sqlite3` behind the same interface.
- The browser cannot reach any RPC method that is not on the list; new pages that need one add it to config, and the
  proxy tests show the change.
