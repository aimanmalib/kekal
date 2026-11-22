-- Off-chain data for Kekal (PRD 4.9). Portable subset: runs on SQLite (S0) and Postgres/Supabase (S1).
-- Times are unix seconds. No buyer names, phone numbers or addresses are stored.

create table if not exists shops (
  pubkey      text primary key,
  name        text not null,
  city        text,
  contact     text,
  created_at  bigint not null
);

create table if not exists products (
  id          text primary key,
  shop        text not null references shops (pubkey),
  model       text not null,
  name        text not null,
  created_at  bigint not null
);

create table if not exists warranty_meta (
  pda         text primary key,
  product_id  text references products (id),
  serial      text,
  terms_json  text not null,
  created_at  bigint not null
);

create table if not exists claim_meta (
  pda         text primary key,
  warranty    text not null,
  issue_type  text not null,
  description text,
  transcript  text,
  media_hash  text,
  created_at  bigint not null
);

create table if not exists media (
  id          text primary key,
  owner       text not null,
  kind        text not null,
  sha256      text not null,
  path        text not null,
  created_at  bigint not null
);

-- Runtime values the app may change without a deploy (e.g. keeper_last_run).
create table if not exists config (
  key         text primary key,
  value       text not null,
  updated_at  bigint not null
);

-- Fixed-window rate-limit counters (relayer, demo sessions).
create table if not exists counters (
  key          text not null,
  window_start bigint not null,
  count        integer not null,
  primary key (key, window_start)
);

-- Transaction signatures behind each page timeline.
create table if not exists events (
  signature   text primary key,
  pda         text not null,
  kind        text not null,
  slot        bigint,
  block_time  bigint
);

create index if not exists events_pda on events (pda);
