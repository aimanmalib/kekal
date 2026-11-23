import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DemoSession, DataStore } from "./store";

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
  const dropOld = db.prepare("delete from session_nonces where expires_at < ?");
  const putN = db.prepare("insert into session_nonces (nonce, pubkey, message, expires_at) values (?, ?, ?, ?)");
  const takeN = db.prepare(
    "update session_nonces set used_at = ? where nonce = ? and used_at is null and expires_at >= ? returning nonce, pubkey, message, expires_at",
  );
  const putDemo = db.prepare(
    "insert into demo_sessions (warranty, holder, shop, kind, created_at) values (?, ?, ?, ?, ?) on conflict(warranty) do nothing",
  );
  const getDemo = db.prepare("select warranty, holder, shop, kind, created_at from demo_sessions where warranty = ?");
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
    putNonce: (n, at) => {
      dropOld.run(at);
      putN.run(n.nonce, n.pubkey, n.message, n.expiresAt);
    },
    takeNonce: (nonce, at) => {
      const r = takeN.get(at, nonce, at) as { nonce: string; pubkey: string; message: string; expires_at: number | bigint } | undefined;
      return r ? { nonce: r.nonce, pubkey: r.pubkey, message: r.message, expiresAt: Number(r.expires_at) } : null;
    },
    putDemoSession: (d) => {
      putDemo.run(d.warranty, d.holder, d.shop, d.kind, d.createdAt);
    },
    getDemoSession: (warranty) => {
      const r = getDemo.get(warranty) as
        | { warranty: string; holder: string; shop: string; kind: DemoSession["kind"]; created_at: number | bigint }
        | undefined;
      return r ? { warranty: r.warranty, holder: r.holder, shop: r.shop, kind: r.kind, createdAt: Number(r.created_at) } : null;
    },
    close: () => db.close(),
  };
}
