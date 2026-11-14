#!/usr/bin/env bash
# Single test gate: format, lint, program tests, SDK and script tests.
#   KEKAL_LIFECYCLE=1  also runs paths A-E on a throwaway local validator (scripts/localnet.sh).
set -euo pipefail
# Hooks export GIT_* that point at the real repository; nothing here may inherit them.
while read -r v; do unset "$v"; done < <(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p')

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for d in "$HOME/.cargo/bin" "$HOME/.avm/bin" "$HOME/.local/share/solana/install/active_release/bin"; do
  [ -d "$d" ] && PATH="$d:$PATH"
done
NODE22="$(ls -d "$HOME"/.nvm/versions/node/v22.*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
[ -n "$NODE22" ] && PATH="$NODE22:$PATH"
export PATH
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || { echo "gerbang: Node >= 22 required" >&2; exit 1; }

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
if [ "${KEKAL_LIFECYCLE:-0}" = 1 ]; then
  step "lifecycle A-E on localnet"
  bash scripts/localnet.sh
fi
printf '\ngerbang-ujian: OK\n'
