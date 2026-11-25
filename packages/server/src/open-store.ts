import { isAbsolute, join } from "node:path";
import { openPostgres, type PostgresOptions } from "./postgres";
import { findUp, openSqlite } from "./sqlite";
import { backendName, type DataStore } from "./store";

/** config/app.json web.data: shared by the web app and the keeper, which open the same store. */
export interface DataConfig {
  backend: string;
  sqlitePath: string;
  migrationsDir: string;
  postgres: Omit<PostgresOptions, "url" | "ssl"> & { urlEnv: string; ssl: string };
}

/**
 * Opens the store DATA_BACKEND names (config default otherwise). sqlite: KEKAL_SQLITE_PATH or the config path, relative
 * to `cwd`. supabase: the Postgres URL from the variable web.data.postgres.urlEnv names. KEKAL_MIGRATIONS_DIR overrides
 * the migrations folder, which is otherwise found by walking up from `cwd`.
 */
export function openStore(env: Record<string, string | undefined>, data: DataConfig, cwd: string): DataStore {
  const backend = backendName(env, data.backend);
  const migrations = env.KEKAL_MIGRATIONS_DIR ?? findUp(data.migrationsDir, cwd);
  if (!migrations) throw new Error(`migrations folder ${data.migrationsDir} not found; set KEKAL_MIGRATIONS_DIR`);
  if (backend === "supabase") {
    const { urlEnv, ssl, ...pg } = data.postgres;
    const url = env[urlEnv]?.trim();
    if (!url) throw new Error(`DATA_BACKEND=supabase needs ${urlEnv} (the database connection string)`);
    if (ssl !== "require" && ssl !== "disable") throw new Error(`web.data.postgres.ssl must be require or disable (got "${ssl}")`);
    return openPostgres({ ...pg, ssl, url }, migrations);
  }
  const raw = env.KEKAL_SQLITE_PATH ?? data.sqlitePath;
  return openSqlite(raw === ":memory:" || isAbsolute(raw) ? raw : join(cwd, raw), migrations);
}
