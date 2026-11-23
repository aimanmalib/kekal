import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { findUp } from "../src/lib/data";
import { migrate, openSqlite } from "@kekal/server";
import { backendName } from "@kekal/server";

const MIGRATIONS = resolve(__dirname, "../../../supabase/migrations");
const tmp: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "kekal-web-"));
  tmp.push(d);
  return d;
};
afterEach(() => {
  while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true });
});

describe("sqlite store", () => {
  it("creates every PRD table", () => {
    const db = new DatabaseSync(":memory:");
    expect(migrate(db, MIGRATIONS, 1)).toContain("0001_init.sql");
    const names = (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ["shops", "products", "warranty_meta", "claim_meta", "media", "config", "counters", "events"]) {
      expect(names).toContain(t);
    }
    db.close();
  });

  it("applies each migration once", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, MIGRATIONS, 1);
    expect(migrate(db, MIGRATIONS, 2)).toEqual([]);
    db.close();
  });

  it("rolls back a failing migration and names it", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "0001_ok.sql"), "create table a (x integer);");
    writeFileSync(join(dir, "0002_bad.sql"), "create table b (x integer); insert into nope values (1);");
    const db = new DatabaseSync(":memory:");
    expect(() => migrate(db, dir, 1)).toThrow(/0002_bad.sql/);
    const tables = (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain("a");
    expect(tables).not.toContain("b");
    db.close();
  });

  it("stores config values and survives a reopen", () => {
    const path = join(tempDir(), "sub", "kekal.db");
    const s = openSqlite(path, MIGRATIONS, 100);
    expect(s.getConfig("keeper_last_run")).toBeNull();
    s.setConfig("keeper_last_run", "123", 100);
    s.setConfig("keeper_last_run", "456", 101);
    s.close();
    const again = openSqlite(path, MIGRATIONS, 200);
    expect(again.getConfig("keeper_last_run")).toBe("456");
    again.close();
  });

  it("counts hits per fixed window", () => {
    const s = openSqlite(":memory:", MIGRATIONS, 0);
    expect(s.hit("ip:1", 3600, 7200)).toBe(1);
    expect(s.hit("ip:1", 3600, 10799)).toBe(2);
    expect(s.hit("ip:2", 3600, 10799)).toBe(1);
    expect(s.hit("ip:1", 3600, 10800)).toBe(1);
    s.close();
  });
});

describe("backendName", () => {
  it("reads DATA_BACKEND, falls back to config, rejects others", () => {
    expect(backendName({}, "sqlite")).toBe("sqlite");
    expect(backendName({ DATA_BACKEND: "Supabase" }, "sqlite")).toBe("supabase");
    expect(() => backendName({ DATA_BACKEND: "mysql" }, "sqlite")).toThrow(/sqlite or supabase/);
  });
});

describe("findUp", () => {
  it("finds a folder in a parent directory", () => {
    const root = tempDir();
    mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    expect(findUp("supabase/migrations", join(root, "apps", "web"))).toBe(join(root, "supabase", "migrations"));
    expect(findUp("no/such/dir", join(root, "apps"))).toBeNull();
  });
});
