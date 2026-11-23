-- Warranties issued by the no-wallet demo (PRD 4.6). Seller and arbiter demo actions are allowed only on these.
-- Only public keys are stored; the dying shop's owner key is discarded after the issue.
create table if not exists demo_sessions (
  warranty    text primary key,
  holder      text not null,
  shop        text not null,
  kind        text not null check (kind in ('shared', 'dying')),
  created_at  bigint not null
);

create index if not exists demo_sessions_created on demo_sessions (created_at);
