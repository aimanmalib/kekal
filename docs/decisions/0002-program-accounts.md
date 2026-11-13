# ADR 0002: Program accounts, token program and pause scope

- Status: accepted
- Date: 2026-11-13

## Context

The spec fixes the accounts (`Config`, `Shop`, vault, `Warranty`, `Claim`) and the 20 instructions. It leaves open which token
program the vault uses, what `paused` blocks, and how the admin limits are passed.

## Decision

- **Classic SPL Token only.** Vaults and transfers use the original Token program with `transfer_checked`. The allowed mints
  (demo kUSD and devnet USDC) are classic mints. Token-2022 extensions such as transfer fees would break the rule that the
  vault always holds at least `free + locked`, so they are out.
- **`paused` blocks new obligations only:** `create_shop` and `issue_warranty`. Deposits, withdrawals of the free balance,
  heartbeats, claims and every permissionless exit keep working, so a pause can never trap a reserve.
- **Admin limits travel as one struct** (`ConfigLimits` inside `ConfigParams`). `init_config` and `set_config` share one
  validation: every minimum is above zero and not above its maximum. The values come from `config/` at deploy time.
- **Shop windows are copied into the shop at creation** and never change, so a later `set_config` does not move the
  deadlines of warranties already issued.
- **`init_config` is open to the first caller.** The deploy script calls it right after deploying. Binding it to the
  upgrade authority is noted as a known limit in the security notes.

## Consequences

Owner-signed instructions refresh `last_seen`. A shop that missed its heartbeat window cannot issue new warranties until it
sends a heartbeat, but it is not dormant until someone calls `declare_dormant`.
