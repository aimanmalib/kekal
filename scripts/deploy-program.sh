#!/usr/bin/env bash
# Deploys (or upgrades) the program on a cluster from config/app.json, then creates Config in the same run.
#   bash scripts/deploy-program.sh devnet
# Steps: check the build matches declare_id! and Anchor.toml; print size, sha256 and rent; `solana program deploy`
# with the deployer key as payer and upgrade authority (no --max-len: the program account is sized to this build);
# `init-config` right away, which fails unless Config.admin is the deployer; publish the IDL; close leftover buffers;
# show the program.
# The keys directory holds deployer.json and program.json (the program keypair); key contents are never printed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/toolchain.sh
source "$ROOT/scripts/lib/toolchain.sh"
CLUSTER="${1:?usage: deploy-program.sh <cluster>}"
cd "$ROOT"

cfg() { node -e 'const c=require("./config/app.json").clusters[process.argv[1]]; if(!c) process.exit(2); const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],c); console.log(v ?? "")' "$CLUSTER" "$1"; }
RPC="$(cfg 'rpcUrls.0')"
KEYS="$(cfg keysDir)"; KEYS="${KEYS/#\~/$HOME}"
[ -n "$RPC" ] && [ -n "$KEYS" ] || { echo "deploy-program: cluster $CLUSTER needs rpcUrls and keysDir in config/app.json" >&2; exit 2; }
DEPLOYER="$KEYS/deployer.json"
PROGRAM_KEY="$KEYS/program.json"
SO="$ROOT/target/deploy/kekal.so"
for f in "$DEPLOYER" "$PROGRAM_KEY" "$SO"; do [ -f "$f" ] || { echo "deploy-program: missing $(basename "$f")" >&2; exit 2; }; done

# The address must be the same everywhere before any SOL is spent.
ID="$(solana-keygen pubkey "$PROGRAM_KEY")"
DECLARED="$(sed -n 's/^declare_id!("\([^"]*\)");/\1/p' programs/kekal/src/lib.rs)"
TOML="$(sed -n "/^\[programs\.$CLUSTER\]/,/^\[/ s/^kekal = \"\([^\"]*\)\"/\1/p" Anchor.toml)"
CONFIGURED="$(cfg programId)"
for v in "$DECLARED" "$TOML" "$CONFIGURED"; do
  [ "$v" = "$ID" ] || { echo "deploy-program: program key $ID differs from declare_id!/Anchor.toml/config ($DECLARED/$TOML/$CONFIGURED)" >&2; exit 2; }
done
bash scripts/sync-idl.sh --check

BYTES="$(stat -c %s "$SO")"
echo "program  $ID"
echo "build    $BYTES bytes, sha256 $(sha256sum "$SO" | cut -d' ' -f1)"
echo "rent     $(solana rent "$BYTES" --url "$RPC" | sed -n 's/^Rent-exempt minimum: //p') for the program data (a buffer of the same size is held while writing)"
echo "deployer $(solana-keygen pubkey "$DEPLOYER"), balance $(solana balance --keypair "$DEPLOYER" --url "$RPC")"

solana program deploy "$SO" --program-id "$PROGRAM_KEY" --keypair "$DEPLOYER" --upgrade-authority "$DEPLOYER" \
  --url "$RPC" --commitment confirmed
# Config takes its first caller as admin: create it now, and stop if someone else got there first.
pnpm --silent --filter @kekal/scripts exec tsx init-config.ts --cluster "$CLUSTER" ${DEPLOY_REPORT:+--out "$DEPLOY_REPORT"}
# The IDL goes on chain so explorers show instruction names (first deploy: init; later: upgrade).
anchor idl upgrade -f target/idl/kekal.json "$ID" --provider.cluster "$RPC" --provider.wallet "$DEPLOYER" \
  || anchor idl init -f target/idl/kekal.json "$ID" --provider.cluster "$RPC" --provider.wallet "$DEPLOYER"
solana program close --buffers --keypair "$DEPLOYER" --url "$RPC" --bypass-warning || true
solana program show "$ID" --keypair "$DEPLOYER" --url "$RPC"
echo "deployer balance after: $(solana balance --keypair "$DEPLOYER" --url "$RPC")"
