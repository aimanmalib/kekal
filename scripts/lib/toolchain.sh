# Sourced by the gate scripts: clears inherited GIT_* (hooks point them at the real repository) and puts the Solana, Anchor,
# Rust and Node 22 toolchains on PATH. Fails when Node is older than 22.
while read -r v; do unset "$v"; done < <(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p')
for d in "$HOME/.cargo/bin" "$HOME/.avm/bin" "$HOME/.local/share/solana/install/active_release/bin"; do
  [ -d "$d" ] && PATH="$d:$PATH"
done
NODE22="$(ls -d "$HOME"/.nvm/versions/node/v22.*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
[ -n "$NODE22" ] && PATH="$NODE22:$PATH"
export PATH
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || { echo "Node >= 22 required" >&2; exit 1; }
