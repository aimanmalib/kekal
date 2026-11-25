#!/usr/bin/env bash
# Single test gate: no tracked cache files, format, lint, program tests, SDK, script and web tests, web build, target sweep tests (needs cargo-sweep), video cut tests,
# deploy script tests (needs python3 for a local static server).
#   Store tests on a throwaway Postgres run when docker is usable (KEKAL_POSTGRES=0 skips, =1 requires them).
#   KEKAL_LIFECYCLE=1  also runs paths A-E, then the demo steps + keeper check, on throwaway local validators
#                      (scripts/localnet.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/toolchain.sh
. scripts/lib/toolchain.sh

step() { printf '\n== %s\n' "$*"; }

step "no compiled or cache files tracked"
# Bytecode and cache files embed the absolute path of the machine that built them.
if git rev-parse --git-dir >/dev/null 2>&1; then
  TRACKED="$(git ls-files -- '*.pyc' '*.pyo' '*/__pycache__/*' '*.DS_Store')"
  if [ -n "$TRACKED" ]; then
    printf 'tracked build or cache files:\n%s\n' "$TRACKED" >&2
    exit 1
  fi
fi
step "cargo fmt --check"
cargo fmt --all -- --check
step "anchor build"
anchor build >/dev/null
step "IDL in SDK matches the build"
bash scripts/sync-idl.sh --check
step "clippy -D warnings"
cargo clippy --all-targets --quiet -- -D warnings
step "program tests"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
if cargo test -p kekal --quiet >"$OUT" 2>&1; then
  awk '/^test result:/ {n += $4} END {print "program tests passed:", n}' "$OUT"
else
  tail -n 40 "$OUT" >&2
  exit 1
fi
step "pnpm install"
pnpm install --frozen-lockfile --silent
step "eslint"
pnpm --silent lint
step "typecheck"
pnpm --silent typecheck
step "unit tests"
pnpm --silent test
step "store tests on Postgres (scripts/test-postgres.sh)"
if [ "${KEKAL_POSTGRES:-auto}" = 0 ]; then
  echo "skipped (KEKAL_POSTGRES=0)"
elif docker info >/dev/null 2>&1; then
  bash scripts/test-postgres.sh
elif [ "${KEKAL_POSTGRES:-auto}" = 1 ]; then
  echo "KEKAL_POSTGRES=1 but docker is not usable" >&2
  exit 1
else
  echo "skipped (no docker)"
fi
step "web build (next build, standalone)"
( cd apps/web && NEXT_TELEMETRY_DISABLED=1 pnpm --silent build >/dev/null )
step "sweep-target tests"
bash scripts/test/sweep-target.test.sh
step "video cut tests"
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/video -q
step "deploy script tests"
bash scripts/test/deploy.test.sh
if [ "${KEKAL_LIFECYCLE:-0}" = 1 ]; then
  step "lifecycle A-E on localnet"
  bash scripts/localnet.sh
  step "demo steps + keeper on localnet"
  LOCALNET_SCRIPT=demo-check.ts bash scripts/localnet.sh
fi
printf '\ngerbang-ujian: OK\n'
