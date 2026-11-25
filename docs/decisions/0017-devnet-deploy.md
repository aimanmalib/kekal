# ADR 0017: Devnet deploy in one script, Config created in the same run

- Status: accepted
- Date: 2026-11-25

## Context

`init_config` makes its first caller the admin. Between a deploy and that call, any key could take the program's
configuration. Devnet SOL is scarce, so the deploy should not reserve more space than the build needs, and the public
devnet endpoint rate-limits by IP, which stopped a first lifecycle run that sent five paths in parallel.

## Decision

- **`scripts/deploy-program.sh <cluster>`** checks that the program key, `declare_id!`, `Anchor.toml` and
  `config/app.json` name one address and that the SDK IDL matches the build, prints size, sha256 and rent, then runs
  `solana program deploy` with the deploy key as payer and upgrade authority.
- **`init-config` runs in the same script, right after the deploy.** It creates the kUSD mint (address = the
  `kusd-mint` key) when missing, calls `init_config` with kUSD and the devnet USDC mint, and exits 1 unless
  `Config.admin` is the deploy key and both mints are allowed. A test keeps the two commands adjacent.
- **No `--max-len`.** The program data account is sized to this build. A larger upgrade needs
  `solana program extend` first, which costs only the extra rent when it is needed.
- **The IDL is published on chain** (`anchor idl init`, later `upgrade`) so explorers show instruction names.
- **Leftover buffers are closed** at the end of the script.
- **Scripts pace their RPC requests on public endpoints** (`scriptRpc` in the cluster config: a minimum gap between
  requests and a doubling wait after a 429) and confirm transactions by polling over HTTP, the same way the server
  does, instead of opening websockets.
- The devnet USDC address comes from Circle's published list of USDC contract addresses and was checked on chain
  (token program owner, 6 decimals) before use.

## Consequences

The deploy, Config, IDL and lifecycle results are recorded in `docs/MEASURED.md` with explorer links. Binding
`init_config` to the upgrade authority is still open (README Limits).
