# Sourced. start_validator: a throwaway solana-test-validator with the built program (target/deploy/kekal.so), on the
# localnet ports in config/app.json, and waits until it reaches `readySlot` (a fresh validator rejects transactions until
# its first blockhashes settle). Sets VALIDATOR_URL; stop_validator kills it and removes its ledger.
# Run from the repository root after `anchor build`.
start_validator() {
  local so="target/deploy/kekal.so" program_id rpc_port faucet_port gossip_port port_range ready_slot
  [ -f "$so" ] || { echo "validator: $so missing; run 'anchor build' first" >&2; return 2; }
  read -r program_id rpc_port faucet_port gossip_port port_range ready_slot < <(node -e '
    const idl = require("./packages/sdk/src/idl/kekal.json");
    const c = require("./config/app.json").clusters.localnet;
    const v = c.validator;
    console.log(c.programId || idl.address, v.rpcPort, v.faucetPort, v.gossipPort, v.dynamicPortRange, v.readySlot);
  ')
  VALIDATOR_LEDGER="$(mktemp -d)"
  local log="$VALIDATOR_LEDGER/validator.log"
  solana-test-validator --reset --quiet --ledger "$VALIDATOR_LEDGER" \
    --rpc-port "$rpc_port" --faucet-port "$faucet_port" --gossip-port "$gossip_port" \
    --dynamic-port-range "$port_range" --bind-address 127.0.0.1 \
    --bpf-program "$program_id" "$so" >"$log" 2>&1 &
  VALIDATOR_PID=$!
  VALIDATOR_URL="http://127.0.0.1:$rpc_port"
  for _ in $(seq 1 180); do
    [ "$(solana slot --url "$VALIDATOR_URL" 2>/dev/null || echo 0)" -ge "$ready_slot" ] && return 0
    kill -0 "$VALIDATOR_PID" 2>/dev/null || { tail -n 20 "$log" >&2; return 1; }
    sleep 1
  done
  echo "validator: did not start" >&2
  tail -n 20 "$log" >&2
  return 1
}

stop_validator() {
  if [ -n "${VALIDATOR_PID:-}" ]; then
    kill "$VALIDATOR_PID" 2>/dev/null || true
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi
  [ -n "${VALIDATOR_LEDGER:-}" ] && rm -rf "$VALIDATOR_LEDGER"
  VALIDATOR_PID=""
  VALIDATOR_LEDGER=""
}
