-- One-time sign-in challenges for seller and arbiter sessions (PRD 4.3). The exact message is kept so the
-- signature is checked against what the wallet showed.
create table if not exists session_nonces (
  nonce       text primary key,
  pubkey      text not null,
  message     text not null,
  expires_at  bigint not null,
  used_at     bigint
);

create index if not exists session_nonces_expires on session_nonces (expires_at);
