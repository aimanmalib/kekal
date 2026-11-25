import postgres from "postgres";
import { MIGRATIONS_TABLE, migrationFiles } from "./migrations";
import { windowStart, type DataStore, type DemoSession } from "./store";

/** Connection values from config/app.json web.data.postgres; the URL itself comes from the environment. */
export interface PostgresOptions {
  url: string;
  maxConnections: number;
  connectTimeoutSecs: number;
  idleTimeoutSecs: number;
  /** Used when the URL has no sslmode; "require" for a hosted Supabase database. */
  ssl: "require" | "disable";
  /** Off for the Supabase transaction pooler, which does not keep prepared statements. */
  prepare: boolean;
}

/** Any fixed number shared by every process that migrates the same database (web and keeper start together). */
const MIGRATION_LOCK = 0x6b656b61;

type Sql = postgres.Sql;

/** Applies the migrations not yet recorded, all in one transaction under an advisory lock. Returns names applied now. */
export async function migratePostgres(sql: Sql, migrationsDir: string, now: number): Promise<string[]> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK})`;
    await tx.unsafe(MIGRATIONS_TABLE);
    const done = new Set((await tx<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
    const applied: string[] = [];
    for (const m of migrationFiles(migrationsDir, "postgres")) {
      if (done.has(m.name)) continue;
      try {
        await tx.unsafe(m.sql);
      } catch (e) {
        throw new Error(`migration ${m.name} failed: ${(e as Error).message}`, { cause: e });
      }
      await tx`insert into schema_migrations (name, applied_at) values (${m.name}, ${now})`;
      applied.push(m.name);
    }
    return applied;
  });
}

export function postgresClient(o: PostgresOptions): Sql {
  const urlHasSsl = /[?&]sslmode=/.test(o.url);
  return postgres(o.url, {
    max: o.maxConnections,
    connect_timeout: o.connectTimeoutSecs,
    idle_timeout: o.idleTimeoutSecs,
    prepare: o.prepare,
    onnotice: () => {},
    ...(urlHasSsl ? {} : { ssl: o.ssl === "require" ? "require" : false }),
  });
}

/**
 * The same store as openSqlite on Postgres (Supabase). Returns at once; migrations run in the background and every
 * call waits for them, so a failed migration surfaces on the first call instead of at import.
 */
export function openPostgres(o: PostgresOptions, migrationsDir: string, now = Math.floor(Date.now() / 1000)): DataStore {
  const sql = postgresClient(o);
  const ready = migratePostgres(sql, migrationsDir, now);
  ready.catch(() => {}); // reported by the first call that awaits it
  const q = async <T>(run: () => Promise<T>): Promise<T> => {
    await ready;
    return run();
  };
  return {
    backend: "supabase",
    getConfig: (key) => q(async () => (await sql<{ value: string }[]>`select value from config where key = ${key}`)[0]?.value ?? null),
    setConfig: (key, value, at) =>
      q(async () => {
        await sql`insert into config (key, value, updated_at) values (${key}, ${value}, ${at})
          on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`;
      }),
    hit: (key, windowSecs, at) =>
      q(async () => {
        const [r] = await sql<{ count: number }[]>`insert into counters (key, window_start, count)
          values (${key}, ${windowStart(at, windowSecs)}, 1)
          on conflict (key, window_start) do update set count = counters.count + 1 returning count`;
        if (!r) throw new Error("counter upsert returned no row");
        return Number(r.count);
      }),
    putNonce: (n, at) =>
      q(async () => {
        await sql`delete from session_nonces where expires_at < ${at}`;
        await sql`insert into session_nonces (nonce, pubkey, message, expires_at) values (${n.nonce}, ${n.pubkey}, ${n.message}, ${n.expiresAt})`;
      }),
    takeNonce: (nonce, at) =>
      q(async () => {
        const [r] = await sql<{ nonce: string; pubkey: string; message: string; expires_at: string }[]>`update session_nonces
          set used_at = ${at} where nonce = ${nonce} and used_at is null and expires_at >= ${at}
          returning nonce, pubkey, message, expires_at`;
        return r ? { nonce: r.nonce, pubkey: r.pubkey, message: r.message, expiresAt: Number(r.expires_at) } : null;
      }),
    putDemoSession: (d) =>
      q(async () => {
        await sql`insert into demo_sessions (warranty, holder, shop, kind, created_at)
          values (${d.warranty}, ${d.holder}, ${d.shop}, ${d.kind}, ${d.createdAt}) on conflict (warranty) do nothing`;
      }),
    getDemoSession: (warranty) =>
      q(async () => {
        const [r] = await sql<{ warranty: string; holder: string; shop: string; kind: DemoSession["kind"]; created_at: string }[]>`
          select warranty, holder, shop, kind, created_at from demo_sessions where warranty = ${warranty}`;
        return r ? { warranty: r.warranty, holder: r.holder, shop: r.shop, kind: r.kind, createdAt: Number(r.created_at) } : null;
      }),
    putWarrantyTerms: (pda, termsJson, at) =>
      q(async () => {
        await sql`insert into warranty_meta (pda, terms_json, created_at) values (${pda}, ${termsJson}, ${at}) on conflict (pda) do nothing`;
      }),
    getWarrantyTerms: (pda) =>
      q(async () => (await sql<{ terms_json: string }[]>`select terms_json from warranty_meta where pda = ${pda}`)[0]?.terms_json ?? null),
    close: async () => {
      await ready.catch(() => {});
      await sql.end({ timeout: 5 });
    },
  };
}
