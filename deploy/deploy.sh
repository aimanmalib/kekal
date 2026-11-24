#!/usr/bin/env bash
# Deploy Kekal (web app, and the keeper once the program is on the cluster) behind the host's reverse proxy.
#   deploy/deploy.sh               build HEAD from a clean `git archive`, run it, install the route, verify
#   deploy/deploy.sh --build       build the image only and print its tag (nothing running is touched)
#   deploy/deploy.sh --rollback    run the previous image again (held by the stopped `kekal-undo` container)
#   deploy/deploy.sh --status      containers, tags, rollback image and the public health code
#
# Host values live in deploy/hos.env (not tracked; deploy/hos.env.example lists them). Keys stay in the host folder
# KEKAL_KEYS_HOST points to and reach the containers as a read-only mount: never the image, never the repo.
set -euo pipefail
cd "$(dirname "$0")"
[ -r hos.env ] || { echo "deploy/hos.env missing (copy deploy/hos.env.example)"; exit 1; }
# shellcheck disable=SC1091
. ./hos.env
: "${KEKAL_DOMAIN:?}" "${KEKAL_NETWORK:?}" "${PROXY_CONTAINER:?}" "${PROXY_DYNAMIC_DIR:?}" "${CERT_RESOLVER:?}"
BUILD_CMD=${BUILD_CMD:-docker build}   # an image builder that accepts `docker build` arguments
MIN_FREE_GB=${MIN_FREE_GB:-20}
: "${KEKAL_KEYS_HOST:?}"
[ -d "$KEKAL_KEYS_HOST" ] || { echo "KEKAL_KEYS_HOST is not a folder"; exit 1; }
export KEKAL_NETWORK KEKAL_KEYS_HOST KEKAL_ENV_FILE="${KEKAL_ENV_FILE:-}"
[ -n "$KEKAL_ENV_FILE" ] || unset KEKAL_ENV_FILE
DC="docker compose -f compose.yaml"
[ "${KEKAL_KEEPER:-0}" = 1 ] && DC="$DC --profile devnet"
URL="https://$KEKAL_DOMAIN"
HOLDER=kekal-undo

# Certificates use the HTTP-01 challenge: a name that does not resolve fails it and burns the CA's retry budget.
dns_ok() { getent ahosts "$KEKAL_DOMAIN" >/dev/null; }

health_code() { curl -s -m 20 -o /dev/null -w '%{http_code}' "$URL/api/health" || true; }

build_image() {  # prints the new tag on the last line
  [ -z "$(git -C .. status --porcelain)" ] || { echo "working tree not clean: commit first (the image is built from HEAD)" >&2; exit 1; }
  local free ctx tag
  free=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
  [ "$free" -ge "$MIN_FREE_GB" ] || { echo "less than ${MIN_FREE_GB} GB free on /, stopping" >&2; exit 1; }
  tag=$(git -C .. rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M)
  ctx=$(mktemp -d)
  git -C .. archive HEAD | tar -x -C "$ctx"   # clean tree: untracked and ignored files never reach the image
  $BUILD_CMD -t "kekal:$tag" "$ctx" >&2 || { rm -rf "$ctx"; exit 1; }
  rm -rf "$ctx"
  echo "$tag"
}

hold_previous() {  # $1 = image ID the replaced container ran: keep it by ID in a stopped container
  local prev id=${1:-}
  prev=$(cat PREVIOUS_TAG 2>/dev/null) || { echo "note: first deploy, no rollback image yet"; return 0; }
  [ -n "$id" ] || id=$(docker image inspect -f '{{.Id}}' "kekal:$prev" 2>/dev/null) || id=""
  [ -n "$id" ] || { echo "WARNING: rollback image kekal:$prev not found; --rollback will fail" >&2; return 1; }
  docker rm -f "$HOLDER" >/dev/null 2>&1 || true
  docker tag "$id" "kekal:$prev"
  docker create --name "$HOLDER" --network none --restart no --label "kekal.tag=$prev" "kekal:$prev" >/dev/null
  echo "rollback image held: kekal:$prev (${id:7:12})"
}

case "${1:-}" in
  --status)
    $DC ps
    echo "current $(cat CURRENT_TAG 2>/dev/null || echo -) · previous $(cat PREVIOUS_TAG 2>/dev/null || echo -)"
    docker inspect -f 'rollback holder: {{index .Config.Labels "kekal.tag"}}' "$HOLDER" 2>/dev/null || echo "rollback holder: none"
    echo "public /api/health $(health_code)"; exit 0 ;;
  --build)
    TAG=$(build_image); echo "built kekal:$TAG"; exit 0 ;;
  --rollback)
    dns_ok || { echo "$KEKAL_DOMAIN does not resolve, nothing was changed"; exit 1; }
    TAG=$(cat PREVIOUS_TAG 2>/dev/null) || { echo "no PREVIOUS_TAG"; exit 1; }
    if ! docker image inspect "kekal:$TAG" >/dev/null 2>&1; then
      id=$(docker inspect -f '{{.Image}}' "$HOLDER" 2>/dev/null) || { echo "image kekal:$TAG is gone"; exit 1; }
      docker tag "$id" "kekal:$TAG"
    fi
    [ -r CURRENT_TAG ] && cp CURRENT_TAG PREVIOUS_TAG ;;
  "")
    dns_ok || { echo "$KEKAL_DOMAIN does not resolve: create the DNS record first, nothing was changed"; exit 1; }
    TAG=$(build_image)
    [ -r CURRENT_TAG ] && cp CURRENT_TAG PREVIOUS_TAG ;;
  *) echo "usage: deploy.sh [--build|--rollback|--status]"; exit 2 ;;
esac

old_id=$(docker inspect -f '{{.Image}}' kekal-web 2>/dev/null || true)

docker volume create kekal-data >/dev/null   # external in compose.yaml: `compose down -v` never deletes the data
KEKAL_TAG=$TAG $DC up -d --force-recreate
echo "$TAG" > CURRENT_TAG

route=$(mktemp)
sed -e "s|@DOMAIN@|$KEKAL_DOMAIN|g" -e "s|@CERT_RESOLVER@|$CERT_RESOLVER|g" -e "s|@CONNECT_SRC@|${CONNECT_SRC:-}|g" \
  traefik.yaml.tmpl > "$route"
docker cp "$route" "$PROXY_CONTAINER:$PROXY_DYNAMIC_DIR/kekal.yaml"; rm -f "$route"

for _ in $(seq 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' kekal-web)" = healthy ] && break; sleep 3; done
no_rollback=0; hold_previous "$old_id" || no_rollback=1

# Keep only the current and previous images of this project; the host disk is shared with other projects.
docker images kekal --format '{{.Tag}}' | grep -vxF -e "$TAG" -e "$(cat PREVIOUS_TAG 2>/dev/null || echo -)" \
  | sed 's/^/kekal:/' | xargs -r docker rmi >/dev/null 2>&1 || true

# A new route or certificate can take a little while: wait and retry before calling it a failure.
code=000
for _ in $(seq 6); do code=$(health_code); [ "$code" = 200 ] && break; sleep 10; done
echo "tag $TAG · public /api/health $code"
[ "$code" = 200 ] || { echo "public health is not 200 yet: check the certificate and route; undo with deploy/deploy.sh --rollback"; exit 1; }
[ "$no_rollback" = 0 ] || { echo "live, but no rollback image is held (warning above)"; exit 1; }
