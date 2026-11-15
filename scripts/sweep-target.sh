#!/usr/bin/env bash
# Removes cargo build artifacts in target/ that have not been used for targetSweep.keepDays days (config/build.json),
# using cargo-sweep. The newest build stays, so the next build is not rebuilt from scratch. See ADR 0007.
#   --dry-run          report what would be removed, remove nothing
#   --config FILE      settings file (default: config/build.json)
#   --project DIR      cargo workspace root (default: the repository)
#   --target-dir DIR   cargo target directory (default: DIR/target of the project)
# Exit codes: 0 swept, skipped or disabled; 1 cargo-sweep failed; 2 bad arguments or config.
# A cargo build holding a target lock means "skipped: build in progress" (exit 0, nothing removed). While sweeping,
# this script holds those locks itself, so a build started meanwhile waits instead of racing the removal.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/config/build.json"
PROJECT="$ROOT"
TARGET=""
DRY=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=(--dry-run) ;;
    --config) CONFIG="${2:?--config needs a file}"; shift ;;
    --project) PROJECT="${2:?--project needs a directory}"; shift ;;
    --target-dir) TARGET="${2:?--target-dir needs a directory}"; shift ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "sweep-target: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
TARGET="${TARGET:-$PROJECT/target}"

# Cron runs with PATH=/usr/bin:/bin: add the toolchain directories like scripts/gerbang-ujian.sh does.
for d in "$HOME/.cargo/bin" "$HOME/.avm/bin" "$HOME/.local/share/solana/install/active_release/bin"; do
  [ -d "$d" ] && PATH="$d:$PATH"
done
export PATH

KEEP="$(python3 -I - "$CONFIG" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        k = json.load(f)["targetSweep"]["keepDays"]
except (OSError, ValueError, KeyError, TypeError) as e:
    sys.exit(f"sweep-target: cannot read targetSweep.keepDays from {sys.argv[1]}: {e!r}")
if not isinstance(k, int) or isinstance(k, bool) or not 0 <= k <= 30:
    sys.exit(f"sweep-target: targetSweep.keepDays must be an integer 0-30, got {k!r}")
print(k)
PY
)" || exit 2

stamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
if [ "$KEEP" = 0 ]; then
  echo "$(stamp) sweep-target: disabled (targetSweep.keepDays = 0)"
  exit 0
fi
if ! cargo sweep --version >/dev/null 2>&1; then
  echo "sweep-target: cargo-sweep is not installed; run: cargo install cargo-sweep --locked --version 0.8.0" >&2
  exit 1
fi
if [ ! -d "$TARGET" ]; then
  echo "$(stamp) sweep-target: nothing to do ($TARGET does not exist)"
  exit 0
fi

# Cargo holds an exclusive flock on <profile>/.cargo-lock (newer cargo also .cargo-*-lock) while it builds.
# cargo-sweep takes none of them, so taking them here cannot deadlock with it.
while IFS= read -r -d '' lock; do
  exec {fd}<"$lock"
  if ! flock -n "$fd"; then
    echo "$(stamp) sweep-target: skipped: build in progress (${lock#"$TARGET"/} is locked)"
    exit 0
  fi
done < <(/usr/bin/find "$TARGET" -maxdepth 3 -type f \( -name .cargo-lock -o -name '.cargo-*-lock' \) -print0)

mb() { du -sm "$TARGET" | cut -f1; }
BEFORE="$(mb)"
OUT="$(CARGO_TARGET_DIR="$TARGET" cargo sweep "${DRY[@]}" --time "$KEEP" "$PROJECT" 2>&1)" || {
  printf '%s\n' "$OUT" >&2
  exit 1
}
printf '%s\n' "$OUT"
# cargo-sweep 0.8 logs some failures and still exits 0.
if grep -q -E '^\[(ERROR|WARN)\]' <<<"$OUT"; then
  echo "sweep-target: cargo-sweep reported errors" >&2
  exit 1
fi
if [ ${#DRY[@]} -gt 0 ]; then
  echo "$(stamp) sweep-target: keepDays=$KEEP dry run, target ${BEFORE} MB, nothing removed"
else
  echo "$(stamp) sweep-target: keepDays=$KEEP target ${BEFORE} MB -> $(mb) MB"
fi
