# ADR 0003: Claims, escalation window and payouts

- Status: accepted
- Date: 2026-11-13

## Context

Instructions 9 to 14 move a claim between the holder, the shop and the arbiter. The spec fixes the states and most time
conditions. It leaves open how claim records are numbered, how late a holder may escalate an accepted claim, and how a
payout reaches a holder who has no token account.

## Decision

- **Claim index = the warranty's `claim_count` at filing.** `open_claim` stores that index while the warranty is Claimed.
  Only one claim is open per warranty, and Accepted or Rejected only ever describe the open claim.
- **The holder signs, a separate payer pays.** `file_claim` and `resolve_dispute` take a `payer` signer for fees and rent,
  so a buyer with no SOL can act through a relayer. The claim records the payer in `rent_payer`.
- **Escalating an accepted claim has an end.** After the repair deadline the holder may escalate for `dispute_secs`, the
  same length as the window after a rejection. Past `repair_deadline + dispute_secs` only `close_stale` applies. The two
  windows never overlap, so a holder and the keeper cannot race on the same second.
- **One payout path.** Every instruction that pays a holder uses the same accounts (`PayoutAccounts`) and the same
  function. It checks mint, vault and holder against the shop and warranty, creates the holder's associated token account
  if needed (rent from the payer), sends the full reserve with `transfer_checked`, and updates `locked`, the open claim
  count and the paid statistics once.
- **`transfer_holder` refuses the all-zero key and the current holder**, so a mistyped rotation cannot strand a warranty.

## Consequences

`resolve_dispute` creates the holder's token account even when the arbiter dismisses the claim; the payer covers that
rent. `settle_unanswered`, `settle_stale_dispute` and `claim_orphan` will call the same payout function.
