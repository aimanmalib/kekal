# ADR 0004: Permissionless settlement and the dormant shop

- Status: accepted
- Date: 2026-11-14

## Context

Instructions 15 to 20 need no shop or holder signature: a keeper, the holder's relayer or any stranger may send them. The
spec fixes their time conditions. It leaves open how `claim_orphan` finds the open claim, which error a too-early call
returns, and whether a payout waits for the shop to be active.

## Decision

- **Every time condition is strict "after".** A call at the last second of a window fails with `WindowStillOpen` (or
  `ShopStillActive`, `WarrantyNotExpired`); one second later it succeeds. The owner's or holder's own action is allowed
  up to and including that last second, so the two sides never share a second.
- **`claim_orphan` takes the open claim as an optional account.** A Claimed warranty must pass the claim at
  `["claim", warranty, open_claim]`, which ends as PaidOrphan; an Active warranty must pass none. Anything else is
  `AccountMismatch`, so a keeper cannot pay a warranty while leaving its claim open.
- **Settling an unanswered or stale claim does not check the shop's status.** The holder is owed the reserve either way;
  if the shop is also dormant, `claim_orphan` reaches the same result.
- **`release_expired` moves no tokens.** It only shifts the reserve from `locked` to `free`; the owner withdraws later.
  When the shop went dormant on or before the expiry second, the reserve belongs to the holder (`OwedToHolder`), and
  `claim_orphan` pays it. When it expired first, `claim_orphan` refuses (`ExpiredBeforeDormant`) and release applies.
- **Nothing closes accounts** (spec K6): settled claims and warranties stay on chain as the record.

## Consequences

The keeper reads claim and warranty state, then sends the one instruction whose window has passed. Exactly one of
`claim_orphan` and `release_expired` can succeed for a given warranty, decided by `expires_at` against `dormant_at`.
