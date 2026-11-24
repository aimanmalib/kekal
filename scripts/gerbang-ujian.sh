#!/usr/bin/env bash
# Single test gate: format, lint, program tests, SDK, script and web tests, web build, target sweep tests (needs cargo-sweep),
# deploy script tests (needs python3 for a local static server).
#   KEKAL_LIFECYCLE=1  also runs paths A-E, then the demo steps + keeper check, on throwaway local validators
#                      (scripts/localnet.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/toolchain.sh
. scripts/lib/toolchain.sh

step() { printf '\n== %s\n' "$*"; }

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
step "web build (next build, standalone)"
( cd apps/web && NEXT_TELEMETRY_DISABLED=1 pnpm --silent build >/dev/null )
step "sweep-target tests"
bash scripts/test/sweep-target.test.sh
step "deploy script tests"
bash scripts/test/deploy.test.sh
if [ "${KEKAL_LIFECYCLE:-0}" = 1 ]; then
  step "lifecycle A-E on localnet"
  bash scripts/localnet.sh
  step "demo steps + keeper on localnet"
  LOCALNET_SCRIPT=demo-check.ts bash scripts/localnet.sh
fi
printf '\ngerbang-ujian: OK\n'
