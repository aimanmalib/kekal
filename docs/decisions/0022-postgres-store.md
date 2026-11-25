# ADR 0022: Postgres store behind the same interface

- Status: accepted
- Date: 2026-11-25

## Context

The off-chain store (sign-in challenges, rate-limit counters, demo warranties, terms text, keeper heartbeat) ran on
SQLite only, and `DATA_BACKEND=supabase` failed at start. A hosted Postgres (Supabase) lets the web app and the keeper
share one database without a shared volume, and keeps the data if the host changes. The store interface was
synchronous, which only an in-process database can satisfy.

## Decision

- **Every `DataStore` call returns a promise.** SQLite keeps its synchronous driver underneath; callers await each
  result. The fee relayer still counts its buckets in the same order and stops at the first one over its limit.
- **`openPostgres` (`postgres` client, no native code)** implements the same calls with the same SQL shapes
  (`insert … on conflict … returning` for counters, `update … returning` to take a challenge once).
- **One opener for both processes.** `openStore` picks the adapter from `DATA_BACKEND`, falling back to
  `config/app.json` `web.data.backend` (still `sqlite`). The connection string is read from the variable that
  `web.data.postgres.urlEnv` names (`SUPABASE_DB_URL`), never from a file in the repository. Pool size, timeouts, TLS
  and prepared statements (off, for the Supabase transaction pooler) are config values.
- **Same migration files.** Postgres applies `supabase/migrations/*.sql` in one transaction under an advisory lock,
  so the web app and the keeper can start together. Files ending in `.pg.sql` run on Postgres only:
  `0004_row_level_security.pg.sql` turns row level security on for every table with no policies, so Supabase's public
  Data API returns no rows, while the server's own connection (the table owner) is unaffected.
- **One behaviour suite for both adapters** (`packages/server/test/store-contract.ts`). It runs on SQLite in every
  test run, and on a throwaway Postgres container (`scripts/test-postgres.sh`, data on tmpfs, removed after) when
  docker is available, including a parallel-hits check for lost updates and a check that every table has row level
  security.
- **The live site stays on SQLite** until a hosted database is connected and measured there.

## Consequences

- Health reports `dataBackend` and turns not-ok when the database does not answer, instead of throwing.
- A failed Postgres migration rolls back entirely and is reported by the first store call, naming the file.
- Undo: set `DATA_BACKEND=sqlite` (the default); the SQLite path is unchanged.
