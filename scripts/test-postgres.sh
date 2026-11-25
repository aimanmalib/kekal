#!/usr/bin/env bash
# Runs the store tests (packages/server/test/store.test.ts) on a throwaway local Postgres, the database Supabase runs.
# Needs docker. The container keeps data on tmpfs, publishes a random port on 127.0.0.1, and is removed on exit.
# Values: config/postgres-test.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cfg() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' config/postgres-test.json "$1"; }
IMAGE="$(cfg image)"
NAME="kekal-pgtest-$$"
PASS="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
cleanup() { docker rm -fv "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --rm --name "$NAME" --cpus "$(cfg cpus)" --memory "$(cfg memory)" \
  --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD="$PASS" -p 127.0.0.1::5432 "$IMAGE" >/dev/null
deadline=$(( $(date +%s) + $(cfg readyTimeoutSecs) ))
# The image's init script restarts the server once; ready = it answers a query over TCP.
until docker exec "$NAME" psql -h 127.0.0.1 -U postgres -tAc 'select 1' >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    docker logs --tail 20 "$NAME" >&2 || true
    echo "test-postgres: database not ready" >&2
    exit 1
  fi
  sleep 1
done
PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed 's/.*://')"
export KEKAL_TEST_PG_URL="postgres://postgres:${PASS}@127.0.0.1:${PORT}/postgres?sslmode=disable"
cd packages/server
pnpm --silent exec vitest run --reporter=dot test/store.test.ts
