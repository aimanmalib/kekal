#!/usr/bin/env bash
# Tests deploy/uptime.sh against a local static server (python3 http.server), plus `bash -n` on every deploy script.
# Needs curl and python3 with PyYAML. Prints "deploy tests: OK" when every case passes.
#   UPTIME_SCRIPT=FILE  test another copy of the script (used to prove the tests fail when it checks nothing)
set -euo pipefail
while read -r v; do unset "$v"; done < <(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p')

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UPTIME="${UPTIME_SCRIPT:-$ROOT/deploy/uptime.sh}"
T="$(mktemp -d)"
SRV=""
cleanup() { [ -n "$SRV" ] && kill "$SRV" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
python3 -c "import yaml" 2>/dev/null || fail "python3 PyYAML missing (pip install pyyaml)"
pass() { echo "ok - $*"; }

for f in "$ROOT"/deploy/*.sh; do bash -n "$f" || fail "syntax: $f"; done
pass "deploy scripts parse"

# The proxy route template fills to valid YAML with no placeholder left, and pages carry no-transform.
sed -e 's|@DOMAIN@|kekal.example.com|g' -e 's|@CERT_RESOLVER@|le|g' -e 's|@CONNECT_SRC@||g' \
  "$ROOT/deploy/traefik.yaml.tmpl" >"$T/route.yaml"
! grep -q '@[A-Z_]*@' "$T/route.yaml" || fail "placeholder left in the route"
python3 - "$T/route.yaml" <<'PY' || fail "route is not the expected YAML"
import sys, yaml
h = yaml.safe_load(open(sys.argv[1]))["http"]
r, m = h["routers"], h["middlewares"]
assert "kekal-nocache" in r["kekal"]["middlewares"] and "kekal-compress" in r["kekal"]["middlewares"]
assert "kekal-nocache" not in r["kekal-static"]["middlewares"]
assert "no-transform" in m["kekal-nocache"]["headers"]["customResponseHeaders"]["Cache-Control"]
assert "frame-ancestors 'none'" in m["kekal-headers"]["headers"]["contentSecurityPolicy"]
assert h["services"]["kekal-svc"]["loadBalancer"]["servers"][0]["url"].startswith("http://kekal-web:")
PY
pass "route template: valid YAML, pages no-transform, static assets keep their caching"

mkdir -p "$T/www/api"
echo '<!doctype html><title>x</title>' >"$T/www/index.html"
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$T/www" >/dev/null 2>&1 &
SRV=$!
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done

# The notifier writes "<level> <text>" lines so the cases can count alerts.
printf '#!/bin/sh\necho "$2 $1" >> "%s"\n' "$T/sent" >"$T/notify"
chmod +x "$T/notify"
: >"$T/sent"
run() {  # $1 = epoch seconds
  UPTIME_URL="http://127.0.0.1:$PORT" UPTIME_STATE="$T/state" UPTIME_NOTIFY="$T/notify" UPTIME_NOW="$1" \
    UPTIME_CONTAINER=kekal-uptime-test-none bash "$UPTIME"
}
alerts() { grep -c "^$1 " "$T/sent" 2>/dev/null || true; }
DAY=1764000000

health() { printf '%s' "$1" >"$T/www/api/health"; }

health '{"ok":true,"program":"not_deployed"}'
run $DAY; run $((DAY + 300))
[ "$(alerts warn)" = 0 ] || fail "healthy site raised an alert"
pass "healthy site: no alert"

health '{"ok":false}'
run $((DAY + 600))
[ "$(alerts warn)" = 0 ] || fail "alert after a single failure"
run $((DAY + 900))
[ "$(alerts warn)" = 1 ] || fail "ok:false with HTTP 200 did not alert after two runs"
grep -q 'ok:false' "$T/sent" || fail "alert does not say what failed"
run $((DAY + 1200))
[ "$(alerts warn)" = 1 ] || fail "alert repeated while still down"
pass "200 with ok:false alerts once after two failures"

health '{"ok":true}'
run $((DAY + 1500))
[ "$(alerts info)" = 1 ] || fail "no recovery line"
pass "recovery reported once"

rm "$T/www/api/health"
run $((DAY + 1800)); run $((DAY + 2100))
[ "$(alerts warn)" = 2 ] || fail "a new outage with a different cause did not alert"
grep -q '/api/health=404' "$T/sent" || fail "missing health page not reported"
pass "missing health page alerts"

echo "deploy tests: OK"
