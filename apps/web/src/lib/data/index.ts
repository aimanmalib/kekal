import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { webConfig } from "../config";
import { openSqlite } from "./sqlite";
import { backendName, type DataStore } from "./store";

/** Walks up from `start` to the first folder that holds `rel` (the repo root in dev, the app root in the image). */
export function findUp(rel: string, start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, rel))) return join(dir, rel);
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

let store: DataStore | undefined;

export function dataStore(env: Record<string, string | undefined> = process.env): DataStore {
  if (store) return store;
  const backend = backendName(env, webConfig.data.backend);
  if (backend === "supabase") throw new Error("DATA_BACKEND=supabase is not available in this build");
  const migrations = env.KEKAL_MIGRATIONS_DIR ?? findUp(webConfig.data.migrationsDir, /*turbopackIgnore: true*/ process.cwd());
  if (!migrations) throw new Error(`migrations folder ${webConfig.data.migrationsDir} not found; set KEKAL_MIGRATIONS_DIR`);
  const raw = env.KEKAL_SQLITE_PATH ?? webConfig.data.sqlitePath;
  const path = raw === ":memory:" || isAbsolute(raw) ? raw : join(/*turbopackIgnore: true*/ process.cwd(), raw);
  store = openSqlite(path, migrations);
  return store;
}
