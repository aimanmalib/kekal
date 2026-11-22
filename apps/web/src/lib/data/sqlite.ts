import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DataStore } from "./store";

/** Applies supabase/migrations/*.sql in name order, each once, recorded in schema_migrations. Returns names applied now. */
export function migrate(db: DatabaseSync, migrationsDir: string, now: number): string[] {
  db.exec("create table if not exists schema_migrations (name text primary key, applied_at bigint not null)");
  const done = new Set(
    (db.prepare("select name from schema_migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    db.exec("begin");
    try {
      db.exec(sql);
      db.prepare("insert into schema_migrations (name, applied_at) values (?, ?)").run(f, now);
      db.exec("commit");
    } catch (e) {
      db.exec("rollback");
      throw new Error(`migration ${f} failed: ${(e as Error).message}`, { cause: e });
    }
    applied.push(f);
  }
  return applied;
}

export function openSqlite(path: string, migrationsDir: string, now = Math.floor(Date.now() / 1000)): DataStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 3000;");
  migrate(db, migrationsDir, now);
  const getCfg = db.prepare("select value from config where key = ?");
  const setCfg = db.prepare(
    "insert into config (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
  );
  const bump = db.prepare(
    "insert into counters (key, window_start, count) values (?, ?, 1) on conflict(key, window_start) do update set count = count + 1 returning count",
  );
  return {
    backend: "sqlite",
    getConfig: (key) => (getCfg.get(key) as { value: string } | undefined)?.value ?? null,
    setConfig: (key, value, at) => {
      setCfg.run(key, value, at);
    },
    hit: (key, windowSecs, at) => {
      const start = at - (at % windowSecs);
      return Number((bump.get(key, start) as { count: number | bigint }).count);
    },
    close: () => db.close(),
  };
}
