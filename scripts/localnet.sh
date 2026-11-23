#!/usr/bin/env bash
# Starts a throwaway local validator with the built program, runs scripts/lifecycle.ts (or LOCALNET_SCRIPT, e.g.
# demo-check.ts), stops it.
# Needs `anchor build` first (target/deploy/kekal.so). Ports come from config/app.json (localnet).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/validator.sh
. scripts/lib/validator.sh
trap stop_validator EXIT
start_validator
pnpm --silent --filter @kekal/scripts exec tsx "${LOCALNET_SCRIPT:-lifecycle.ts}" --cluster localnet "$@"
