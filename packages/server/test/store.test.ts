import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { migrationFiles, openPostgres, openSqlite, openStore, type DataConfig, type DataStore, type PostgresOptions } from "../src";
import { storeContract } from "./store-contract";

const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");
const tmp: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "kekal-store-"));
  tmp.push(d);
  return d;
};
afterAll(() => {
  while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true });
});

let sqlitePath = "";
storeContract("sqlite", {
  fresh: async () => openSqlite((sqlitePath = join(tempDir(), "kekal.db")), MIGRATIONS),
  reopen: async () => openSqlite(sqlitePath, MIGRATIONS),
});

describe("migration files", () => {
  it("Postgres-only files (*.pg.sql) are left out for SQLite, kept in name order for Postgres", () => {
    const lite = migrationFiles(MIGRATIONS, "sqlite").map((m) => m.name);
    const pg = migrationFiles(MIGRATIONS, "postgres").map((m) => m.name);
    expect(lite.some((n) => n.endsWith(".pg.sql"))).toBe(false);
    expect(pg.filter((n) => !n.endsWith(".pg.sql"))).toEqual(lite);
    expect(pg).toEqual([...pg].sort());
    expect(pg.some((n) => n.endsWith(".pg.sql"))).toBe(true);
  });
});

const data: DataConfig = {
  backend: "sqlite",
  sqlitePath: "data/kekal.db",
  migrationsDir: "supabase/migrations",
  postgres: { urlEnv: "TEST_DB_URL", maxConnections: 2, connectTimeoutSecs: 5, idleTimeoutSecs: 5, ssl: "require", prepare: false },
};

describe("openStore", () => {
  it("opens SQLite by default, relative to the working folder", async () => {
    const cwd = tempDir();
    const s = openStore({ KEKAL_MIGRATIONS_DIR: MIGRATIONS }, data, cwd);
    expect(s.backend).toBe("sqlite");
    await s.close();
  });
  it("refuses Supabase without a connection string and names the variable", () => {
    expect(() => openStore({ DATA_BACKEND: "supabase", KEKAL_MIGRATIONS_DIR: MIGRATIONS }, data, tempDir())).toThrow(/TEST_DB_URL/);
  });
  it("refuses an unknown ssl setting", () => {
    const bad = { ...data, postgres: { ...data.postgres, ssl: "prefer" } };
    expect(() => openStore({ DATA_BACKEND: "supabase", TEST_DB_URL: "postgres://x@127.0.0.1/x", KEKAL_MIGRATIONS_DIR: MIGRATIONS }, bad, tempDir())).toThrow(
      /require or disable/,
    );
  });
});

// Postgres runs only when a throwaway database is given (scripts/test-postgres.sh starts one in a container).
const PG_URL = process.env.KEKAL_TEST_PG_URL;
const pgOptions = (): PostgresOptions => ({ url: PG_URL!, maxConnections: 4, connectTimeoutSecs: 10, idleTimeoutSecs: 5, ssl: "disable", prepare: false });

describe.skipIf(!PG_URL)("postgres", () => {
  const open: DataStore[] = [];
  const admin = PG_URL ? postgres(PG_URL, { max: 1, onnotice: () => {} }) : null;
  const reset = async () => {
    await admin!.unsafe("drop schema public cascade; create schema public;");
  };
  afterEach(async () => {
    while (open.length) await open.pop()!.close();
  });
  afterAll(async () => {
    await admin?.end({ timeout: 5 });
  });
  const track = (s: DataStore) => (open.push(s), s);

  storeContract("postgres", {
    fresh: async () => {
      await reset();
      return openPostgres(pgOptions(), MIGRATIONS);
    },
    reopen: async () => openPostgres(pgOptions(), MIGRATIONS),
  });

  it("records every migration once, even when two processes start together", async () => {
    await reset();
    const [a, b] = [track(openPostgres(pgOptions(), MIGRATIONS)), track(openPostgres(pgOptions(), MIGRATIONS))];
    await Promise.all([a.getConfig("x"), b.getConfig("x")]);
    const rows = await admin!<{ name: string }[]>`select name from schema_migrations order by name`;
    expect(rows.map((r) => r.name)).toEqual(migrationFiles(MIGRATIONS, "postgres").map((m) => m.name));
  });

  it("turns row level security on for every table, so the Supabase Data API sees no rows", async () => {
    await reset();
    await track(openPostgres(pgOptions(), MIGRATIONS)).getConfig("x");
    const rows = await admin!<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThanOrEqual(11);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("rolls back a failing migration, names it, and fails the first call", async () => {
    await reset();
    const dir = tempDir();
    writeFileSync(join(dir, "0001_ok.sql"), "create table a (x integer);");
    writeFileSync(join(dir, "0002_bad.sql"), "create table b (x integer); insert into nope values (1);");
    await expect(track(openPostgres(pgOptions(), dir)).getConfig("x")).rejects.toThrow(/0002_bad\.sql/);
    const tables = await admin!<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
    expect(tables).toEqual([]);
  });
});
