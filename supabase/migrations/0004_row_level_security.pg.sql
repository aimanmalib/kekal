-- Postgres/Supabase only (SQLite skips *.pg.sql). Supabase serves the public schema over its Data API to anyone with the
-- project's publishable key. Kekal reads and writes only through its own server routes, so row level security is on with no
-- policies: the Data API sees no rows, and the server's direct connection (the table owner) is unaffected.
alter table shops enable row level security;
alter table products enable row level security;
alter table warranty_meta enable row level security;
alter table claim_meta enable row level security;
alter table media enable row level security;
alter table config enable row level security;
alter table counters enable row level security;
alter table events enable row level security;
alter table session_nonces enable row level security;
alter table demo_sessions enable row level security;
alter table schema_migrations enable row level security;
