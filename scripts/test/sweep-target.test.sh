#!/usr/bin/env bash
# Tests scripts/sweep-target.sh against a throwaway cargo crate (no dependencies, --offline).
# Needs cargo, cargo-sweep and flock on the host; prints "sweep-target tests: OK" when every case passes.
#   SWEEP_SCRIPT=FILE  test another copy of the script (used to prove the tests fail when the sweep does nothing)
set -euo pipefail
# Hooks export GIT_* that point at the real repository; nothing here may inherit them.
while read -r v; do unset "$v"; done < <(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p')

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SWEEP="${SWEEP_SCRIPT:-$ROOT/scripts/sweep-target.sh}"
for d in "$HOME/.cargo/bin"; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
unset CARGO_TARGET_DIR CARGO_BUILD_TARGET_DIR
cargo sweep --version >/dev/null 2>&1 || {
  echo "sweep-target tests: cargo-sweep missing; run: cargo install cargo-sweep --locked --version 0.8.0" >&2
  exit 1
}

T="$(mktemp -d)"
LOCKPID=""
cleanup() { [ -n "$LOCKPID" ] && kill "$LOCKPID" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
cd "$T" || exit 1

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok - $*"; }
config() { printf '{"targetSweep": {"keepDays": %s}}\n' "$1" >"$T/build.json"; }
sweep() { bash "$SWEEP" --config "$T/build.json" --project "$C" --target-dir "$C/target" "$@"; }
listing() { (cd "$C/target" && /usr/bin/find . -path ./deploy -prune -o -print | LC_ALL=C sort); }
hashes() { (cd "$C/target" && sha256sum deploy/x-keypair.json idl/x.json types/x.ts); }
rlibs() { /usr/bin/find "$C/target/debug/deps" -name 'libfixture-*.rlib' -printf '%f\n' | LC_ALL=C sort; }

KEEP=3
OLD="$((KEEP + 5)) days ago"
C="$T/fixture"
mkdir -p "$C/src"
cat >"$C/Cargo.toml" <<'EOF'
[package]
name = "fixture"
version = "0.1.0"
edition = "2021"

[features]
extra = []

[workspace]
EOF
printf '#[cfg(feature = "extra")]\npub fn extra() {}\npub fn base() {}\n' >"$C/src/lib.rs"

# An old build (feature on: different metadata hash), aged on both atime and mtime, plus old program outputs.
cargo build --offline --quiet --features extra --manifest-path "$C/Cargo.toml"
OLD_RLIB="$(rlibs)"
[ "$(wc -l <<<"$OLD_RLIB")" = 1 ] || fail "expected one rlib after the first build"
mkdir -p "$C/target/deploy" "$C/target/idl" "$C/target/types"
printf '[1,2,3]\n' >"$C/target/deploy/x-keypair.json"
printf '{"name":"x"}\n' >"$C/target/idl/x.json"
printf 'export type X = 1;\n' >"$C/target/types/x.ts"
/usr/bin/find "$C/target" -exec touch -d "$OLD" {} +
# The current build (feature off).
cargo build --offline --quiet --manifest-path "$C/Cargo.toml"
NEW_RLIB="$(comm -13 <(printf '%s\n' "$OLD_RLIB") <(rlibs))"
[ -n "$NEW_RLIB" ] || fail "the second build did not produce a new rlib"
HASHES="$(hashes)"

# (g) Broken or out-of-range config: exit 2, nothing removed.
BEFORE="$(listing)"
for bad in '{' '{"targetSweep": {}}' '{"targetSweep": {"keepDays": "3"}}' '{"targetSweep": {"keepDays": 31}}' \
  '{"targetSweep": {"keepDays": -1}}' '{"targetSweep": {"keepDays": true}}'; do
  printf '%s\n' "$bad" >"$T/build.json"
  rc=0; sweep >/dev/null 2>&1 || rc=$?
  [ "$rc" = 2 ] || fail "config $bad: exit $rc, expected 2"
done
[ "$(listing)" = "$BEFORE" ] || fail "a broken config removed files"
pass "(g) broken config exits 2 and removes nothing"

# (e) keepDays 0 disables the sweep.
config 0
out="$(sweep)" || fail "keepDays 0 exited non-zero"
grep -q 'disabled' <<<"$out" || fail "keepDays 0 did not print 'disabled': $out"
[ "$(listing)" = "$BEFORE" ] || fail "keepDays 0 removed files"
pass "(e) keepDays 0 prints disabled and removes nothing"

# (d) Control: a threshold longer than the old build's age removes nothing.
config 30
sweep >/dev/null || fail "keepDays 30 exited non-zero"
[ "$(listing)" = "$BEFORE" ] || fail "keepDays 30 removed files younger than 30 days"
pass "(d) keepDays above the artifact age removes nothing"

# (f) A build holding the cargo lock: skipped, nothing removed, exit 0.
config "$KEEP"
# exec: the locking process becomes sleep itself, so killing it releases the lock.
bash -c 'exec 9<"$1"; flock 9; exec sleep 60' _ "$C/target/debug/.cargo-lock" &
LOCKPID=$!
for _ in $(seq 50); do flock -n "$C/target/debug/.cargo-lock" true || break; sleep 0.1; done
out="$(sweep)" || fail "locked target exited non-zero"
kill "$LOCKPID"; wait "$LOCKPID" 2>/dev/null || true; LOCKPID=""
grep -q 'skipped: build in progress' <<<"$out" || fail "locked target was not skipped: $out"
[ "$(listing)" = "$BEFORE" ] || fail "locked target had files removed"
pass "(f) a held build lock skips the sweep"

# Dry run reports but removes nothing.
sweep --dry-run >/dev/null || fail "dry run exited non-zero"
[ "$(listing)" = "$BEFORE" ] || fail "dry run removed files"
pass "dry run removes nothing"

# (a) The old build is removed.
sweep >/dev/null || fail "sweep exited non-zero"
[ -e "$C/target/debug/deps/$OLD_RLIB" ] && fail "old build $OLD_RLIB was not removed"
pass "(a) the build unused for more than keepDays is removed"

# (b) The current build stays and is still fresh.
[ -e "$C/target/debug/deps/$NEW_RLIB" ] || fail "current build $NEW_RLIB was removed"
log="$(cargo build --offline --manifest-path "$C/Cargo.toml" 2>&1)"
grep -q 'Compiling' <<<"$log" && fail "current build was rebuilt after the sweep: $log"
pass "(b) the current build stays and is not rebuilt"

# (c) target/deploy, target/idl and target/types are untouched.
[ "$(hashes)" = "$HASHES" ] || fail "deploy/idl/types changed"
pass "(c) deploy keypair, idl and types unchanged"

echo "sweep-target tests: OK"
