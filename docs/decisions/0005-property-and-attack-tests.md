# ADR 0005: Property, liveness and attack tests

- Status: accepted
- Date: 2026-11-14

## Context

The spec asks for invariants I1 to I4 checked after 200 seeded pseudo-random steps, a liveness check (L1) from every
non-final state, the `claim_orphan` against `release_expired` race in both directions, and a set of attacks. It leaves
open how to generate the steps and what counts as "unchanged" after a failed attack.

## Decision

- **Random walks use an inline SplitMix64 generator**, no extra crate. Four fixed seeds, 200 steps each, three shops.
  Each step picks one of the 20 instructions (or a clock jump, or a stranger's attack) for a random shop or warranty;
  failures are allowed. After every step the test checks:
  - I1: vault token balance ≥ `free + locked` for every shop;
  - I2: `locked` = sum of reserves of Active and Claimed warranties;
  - I3: issued reserves = `locked + paid_amount + released_amount`, and Paid out / Released never change again;
  - holders' token accounts together hold exactly the shops' `paid_amount`;
  - I4: a stranger's claim, transfer, escalation or withdrawal always fails and leaves every shop and warranty as it was.
  The test also asserts the walks reached payouts, releases, dormant shops and attacks, so a walk that never leaves
  the start cannot pass.
- **L1 is checked two ways.** From each non-final state the exit the spec names is refused one second early and
  succeeds at the first allowed second, signed only by a stranger. Then, from the same states, a loop that only
  advances the clock and sends permissionless instructions must bring the reserve out of `locked`.
- **A failed attack must leave the books unchanged** (free, locked, paid amount, shop status), not only return an error.

## Consequences

`dormant_at` is the declaration time (spec row 18). A shop that went silent but was not declared dormant before a
warranty expired gets that reserve back through `release_expired`; a test records this. The keeper therefore declares
dormancy on every pass before it releases anything, and the security notes list keeper downtime as a known limit.
