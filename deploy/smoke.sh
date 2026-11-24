#!/usr/bin/env bash
# Smoke-test an image before it goes live: run it alone, the way compose.yaml runs kekal-web (read-only root,
# tmpfs, a data volume, a read-only key folder), but on the default bridge network with a throwaway volume and an
# empty key folder, so nothing live and no key is involved. Values: config/deploy.json `smoke`.
#   deploy/smoke.sh kekal:<tag>      exit 0 = health ok:true and every listed path answered 200
# Test overrides: SMOKE_HOST (address to probe instead of the container IP), SMOKE_PORT, SMOKE_TIMEOUT (seconds).
set -euo pipefail
IMAGE=${1:?usage: deploy/smoke.sh <image>}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
read -r PORT TIMEOUT PATHS < <(python3 - "$ROOT/config/deploy.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))["smoke"]
print(int(s["port"]), int(s["timeoutSecs"]), " ".join(s["paths"]))
PY
)
PORT=${SMOKE_PORT:-$PORT}
TIMEOUT=${SMOKE_TIMEOUT:-$TIMEOUT}

NAME="kekal-smoke-$$"
KEYS="$(mktemp -d)"
cleanup() {
  docker rm -fv "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$NAME" >/dev/null 2>&1 || true
  rm -rf "$KEYS"
}
trap cleanup EXIT
chmod 755 "$KEYS"   # the image runs as a non-root user

docker volume create "$NAME" >/dev/null
docker run -d --name "$NAME" --network bridge --read-only --tmpfs /tmp --tmpfs /app/apps/web/.next/cache \
  -v "$NAME:/app/data" -v "$KEYS:/app/keys:ro" -e "KEKAL_CLUSTER=${KEKAL_CLUSTER:-devnet}" -e KEKAL_KEYS_DIR=/app/keys \
  --cpus 1 --memory 512m "$IMAGE" >/dev/null
HOST=${SMOKE_HOST:-$(docker inspect -f '{{.NetworkSettings.Networks.bridge.IPAddress}}' "$NAME")}
BASE="http://$HOST:$PORT"

failed() { echo "smoke: $*" >&2; docker logs --tail 20 "$NAME" >&2 2>&1 || true; exit 1; }

body="" code=000
deadline=$(( $(date +%s) + TIMEOUT ))
while :; do
  body=$(curl -s -m 5 -w '\n%{http_code}' "$BASE/api/health" || true)
  code=${body##*$'\n'}; body=${body%$'\n'*}
  [ "$code" = 200 ] && break
  [ "$(date +%s)" -lt "$deadline" ] || failed "/api/health did not answer 200 within ${TIMEOUT}s (last ${code:-000})"
  sleep 2
done
printf '%s' "$body" | python3 -c 'import json, sys; sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)' \
  || failed "/api/health is 200 but not ok:true: $body"

for p in $PATHS; do
  c=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$BASE$p" || true)
  [ "$c" = 200 ] || failed "$p answered ${c:-000}"
done
echo "smoke: $IMAGE ok ($body)"
