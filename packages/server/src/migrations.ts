import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Migration {
  name: string;
  sql: string;
}

export type Dialect = "sqlite" | "postgres";

/** Suffix of a migration only Postgres runs (row level security has no SQLite form). */
export const POSTGRES_ONLY = ".pg.sql";

/**
 * The supabase/migrations/*.sql files in name order. Both adapters apply the same portable files, each once;
 * files ending in .pg.sql are Postgres-only.
 */
export function migrationFiles(migrationsDir: string, dialect: Dialect): Migration[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && (dialect === "postgres" || !f.endsWith(POSTGRES_ONLY)))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));
}

export const MIGRATIONS_TABLE = "create table if not exists schema_migrations (name text primary key, applied_at bigint not null)";
