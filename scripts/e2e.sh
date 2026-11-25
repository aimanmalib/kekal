#!/usr/bin/env bash
# Browser end-to-end tests (e2e/): a throwaway local validator, sample warranties and test wallets
# (scripts/page-fixtures.ts), the built web app (next start on config/e2e.json `port`), then Playwright on every
# project in config/e2e.json (Chromium desktop, WebKit iPhone 13).
#   E2E_SKIP_BUILD=1   reuse apps/web/.next from an earlier `next build`
#   E2E_SHOTS=<dir>    also save screenshots there
#   E2E_LANG=en|ms     language of the /kedai run instead of each project's config/e2e.json `lang`
#   E2E_VIDEO=<dir>    also record each page as <project>-<step>.webm there (demo video footage, ADR 0019)
#   E2E_SLOWMO_MS=<n>  slow every browser action by n ms (for recordings)
#   further arguments go to `playwright test` (e.g. --project=webkit-iphone13, -g "path B")
# Needs `anchor build` first. Browsers: Playwright's cache (`pnpm --filter @kekal/e2e exec playwright install chromium webkit`).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/toolchain.sh
. scripts/lib/toolchain.sh
# shellcheck source=lib/validator.sh
. scripts/lib/validator.sh

read -r PORT HEALTH_SECS WALLETS < <(node -e '
  const c = require("./config/e2e.json");
  console.log(c.port, c.healthTimeoutSecs, Math.max(...c.projects.map((p) => p.wallet)) + 1);
')
if ss -ltn "sport = :$PORT" | grep -q LISTEN; then echo "e2e: port $PORT is already in use" >&2; exit 1; fi

WORK="$(mktemp -d)"
WEB_PID=""
cleanup() {
  if [ -n "$WEB_PID" ]; then kill "$WEB_PID" 2>/dev/null || true; wait "$WEB_PID" 2>/dev/null || true; fi
  stop_validator
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ "${E2E_SKIP_BUILD:-0}" != 1 ]; then
  echo "e2e: next build"
  ( cd apps/web && NEXT_TELEMETRY_DISABLED=1 pnpm --silent build >/dev/null )
fi
[ -f apps/web/.next/BUILD_ID ] || { echo "e2e: apps/web/.next missing; run without E2E_SKIP_BUILD" >&2; exit 2; }

echo "e2e: local validator"
start_validator

echo "e2e: sample warranties and $WALLETS test wallets"
pnpm --silent --filter @kekal/scripts exec tsx page-fixtures.ts --cluster localnet --dir "$WORK/fx" --wallets "$WALLETS"
MINT="$(node -p 'require(process.argv[1]).mint' "$WORK/fx/fixtures.json")"

echo "e2e: web app on port $PORT"
(
  cd apps/web
  KEKAL_CLUSTER=localnet KEKAL_KEYS_DIR="$WORK/fx/keys" KEKAL_SQLITE_PATH="$WORK/fx/kekal.db" KEKAL_MINTS="$MINT" \
    KEKAL_SESSION_SECRET="$(node -p 'require("node:crypto").randomBytes(32).toString("hex")')" \
    KEKAL_SITE_URL="http://localhost:$PORT" NEXT_TELEMETRY_DISABLED=1 \
    exec node node_modules/next/dist/bin/next start --port "$PORT"
) >"$WORK/web.log" 2>&1 &
WEB_PID=$!
for _ in $(seq 1 "$HEALTH_SECS"); do
  curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  kill -0 "$WEB_PID" 2>/dev/null || { tail -n 20 "$WORK/web.log" >&2; exit 1; }
  sleep 1
done
curl -fsS "http://localhost:$PORT/api/health" >/dev/null || { echo "e2e: web app not healthy" >&2; tail -n 20 "$WORK/web.log" >&2; exit 1; }

echo "e2e: playwright"
set +e
E2E_BASE_URL="http://localhost:$PORT" E2E_FIXTURES="$WORK/fx/fixtures.json" E2E_KEYS="$WORK/fx/keys" \
  E2E_OUTPUT="$WORK/results" pnpm --silent --filter @kekal/e2e exec playwright test "$@"
RC=$?
set -e
[ "$RC" = 0 ] || tail -n 20 "$WORK/web.log" >&2
exit "$RC"
