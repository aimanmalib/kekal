import { isAbsolute, join } from "node:path";
import { webConfig } from "../config";
import { backendName, findUp, openSqlite, type DataStore } from "@kekal/server";

export { findUp };

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
