#!/usr/bin/env bash
# Starts a throwaway local validator with the built program, runs scripts/lifecycle.ts, stops it.
# Needs `anchor build` first (target/deploy/kekal.so). Ports come from config/app.json (localnet).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SO="target/deploy/kekal.so"
[ -f "$SO" ] || { echo "localnet: $SO missing; run 'anchor build' first" >&2; exit 2; }

read -r PROGRAM_ID RPC_PORT FAUCET_PORT GOSSIP_PORT PORT_RANGE < <(node -e '
  const idl = require("./packages/sdk/src/idl/kekal.json");
  const c = require("./config/app.json").clusters.localnet;
  const v = c.validator;
  console.log(c.programId || idl.address, v.rpcPort, v.faucetPort, v.gossipPort, v.dynamicPortRange);
')

LEDGER="$(mktemp -d)"
LOG="$LEDGER/validator.log"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --rpc-port "$RPC_PORT" --faucet-port "$FAUCET_PORT" --gossip-port "$GOSSIP_PORT" \
  --dynamic-port-range "$PORT_RANGE" --bind-address 127.0.0.1 \
  --bpf-program "$PROGRAM_ID" "$SO" >"$LOG" 2>&1 &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; rm -rf "$LEDGER"; }
trap cleanup EXIT

URL="http://127.0.0.1:$RPC_PORT"
for _ in $(seq 1 90); do
  solana cluster-version --url "$URL" >/dev/null 2>&1 && break
  kill -0 "$PID" 2>/dev/null || { tail -n 20 "$LOG" >&2; exit 1; }
  sleep 1
done
solana cluster-version --url "$URL" >/dev/null 2>&1 || { echo "localnet: validator did not start" >&2; tail -n 20 "$LOG" >&2; exit 1; }

pnpm --silent --filter @kekal/scripts exec tsx lifecycle.ts --cluster localnet "$@"
