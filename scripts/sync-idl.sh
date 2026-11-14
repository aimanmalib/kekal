#!/usr/bin/env bash
# Copies the IDL from `anchor build` into the SDK. `--check` fails when they differ.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/target/idl/kekal.json"
DST="$ROOT/packages/sdk/src/idl/kekal.json"
[ -f "$SRC" ] || { echo "sync-idl: $SRC missing; run 'anchor build'" >&2; exit 2; }
if [ "${1:-}" = "--check" ]; then
  cmp -s "$SRC" "$DST" || { echo "sync-idl: SDK IDL is stale; run scripts/sync-idl.sh" >&2; exit 1; }
else
  cp "$SRC" "$DST"
fi
