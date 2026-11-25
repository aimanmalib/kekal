import { webConfig } from "../config";
import { findUp, openStore, type DataStore } from "@kekal/server";

export { findUp };

let store: DataStore | undefined;

/** The one store for this process (SQLite or Supabase Postgres, by DATA_BACKEND; see config/app.json web.data). */
export function dataStore(env: Record<string, string | undefined> = process.env): DataStore {
  store ??= openStore(env, webConfig.data, /*turbopackIgnore: true*/ process.cwd());
  return store;
}
