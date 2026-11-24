#!/usr/bin/env bash
# Uptime watch for Kekal (run from cron every 5 minutes): GET / and /api/health through the public URL.
# Two failures in a row = one "unhealthy" alert; recovery = one info line; each distinct text at most once per UTC day.
# The health body is checked too: `"ok":true` must be present (a 200 with ok:false is a failure).
# Host values come from deploy/hos.env (KEKAL_DOMAIN, NOTIFY_CMD). State: deploy/.uptime-state (not tracked).
# Test overrides: UPTIME_URL, UPTIME_STATE, UPTIME_NOTIFY, UPTIME_NOW (epoch seconds), UPTIME_CONTAINER.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck disable=SC1091
[ -r "$ROOT/deploy/hos.env" ] && . "$ROOT/deploy/hos.env"
URL=${UPTIME_URL:-https://${KEKAL_DOMAIN:-localhost}}
STATE=${UPTIME_STATE:-$ROOT/deploy/.uptime-state}
NOTIFY=${UPTIME_NOTIFY:-${NOTIFY_CMD:-}}
NOW=${UPTIME_NOW:-$(date +%s)}
CONTAINER=${UPTIME_CONTAINER:-kekal-web}
DAY=$(date -u -d "@$NOW" +%F)
UA="KekalUptime/0.1"

# State: line 1 = "<up|down> <failures>", then "sent <day> <hash of text>" lines for today.
prev=up; fails=0
if [ -f "$STATE" ]; then read -r prev fails < <(head -1 "$STATE"); fi
[[ "${prev:-}" =~ ^(up|down)$ ]] || prev=up
[[ "${fails:-}" =~ ^[0-9]+$ ]] || fails=0
sent=$(grep "^sent $DAY " "$STATE" 2>/dev/null || true)

send() {  # $1 text, $2 level; once per text per UTC day
  local h; h=$(printf '%s' "$1" | md5sum | cut -c1-16)
  grep -q " $h\$" <<< "$sent" && return 0
  sent=$(printf '%s\nsent %s %s' "$sent" "$DAY" "$h")
  [ -n "$NOTIFY" ] && NOTIFY_KOD_KELUAR=1 "$NOTIFY" "$1" "$2" >/dev/null 2>&1
  return 0
}

bad=""
c=$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" -m 25 "$URL/" || true)
[ "${c:-000}" = 200 ] || bad="$bad /=${c:-000}"
body=$(curl -s -A "$UA" -m 25 -w '\n%{http_code}' "$URL/api/health" || true)
c=${body##*$'\n'}
if [ "$c" != 200 ]; then bad="$bad /api/health=${c:-000}"
elif ! grep -q '"ok":true' <<< "$body"; then bad="$bad /api/health=ok:false"; fi
ctr=$(docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null) || ctr=missing

if [ -z "$bad" ]; then
  [ "$prev" = down ] && send "Kekal ($URL) recovered: site and /api/health answer 200, container $ctr." info
  prev=up; fails=0
else
  fails=$((fails + 1))
  if [ "$fails" -ge 2 ] && [ "$prev" = up ]; then
    send "Kekal ($URL) is unhealthy:$bad; container $ctr. Check deploy/deploy.sh --status; undo with --rollback." warn
    prev=down
  fi
fi

{ echo "$prev $fails"; grep . <<< "$sent" || true; } > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
exit 0
