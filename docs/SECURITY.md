# Security

Kekal runs on Solana devnet only. It has not had a third-party audit. Do not use it with real money.

To report a problem, open a private security advisory on this repository rather than a public issue.

## What is at stake

The vault of each shop holds stablecoin: the shop's free balance plus one reserve per live warranty. The things that
must not happen:

1. A reserve leaves the vault to anyone other than the warranty's current holder, or leaves twice.
2. A shop takes back a reserve that is owed to a holder (a live warranty, an open claim, or a shop that went silent).
3. A reserve gets stuck: some state from which no one can move it, ever.
4. The fee relayer is made to sign or pay for something other than the narrow set of transactions it exists for.

## Actors and trust

| Actor | Holds | Trusted for | Not trusted for |
| --- | --- | --- | --- |
| Shop owner | wallet key of the shop | answering claims, depositing, issuing | anything touching a locked reserve |
| Holder | card key (in the QR card's URL fragment) | filing, confirming and escalating its own claim, moving the card to a new key | anything on another warranty |
| Arbiter | wallet key named on the shop | deciding a disputed claim of that shop, within the dispute timeout | anything else; silence loses to the deadline |
| Admin | config key (also the upgrade authority on devnet) | limits, allowed mints, default arbiter, pause | moving any shop's money |
| Anyone | any key | sending the permissionless steps once they fall due | choosing the outcome of those steps |
| Relayer | server fee-payer key | paying fees and rent for holder and permissionless steps | signing as anything but fee payer and rent payer |
| Keeper | the relayer key, as fee payer | sending due steps on time | deciding anything the program does not already allow |

## Invariants

Checked by the property tests after every step of four seeded random walks of 200 steps over three shops
([ADR 0005](decisions/0005-property-and-attack-tests.md), `programs/kekal/tests/test_invariants.rs`):

- **I1** For every shop, the vault's token balance is at least `free + locked`. Accounting never reads the token balance.
- **I2** `locked` equals the sum of reserves of the shop's Active and Claimed warranties.
- **I3** A warranty's reserve leaves `locked` exactly once: issued reserves = `locked + paid_amount + released_amount`,
  and a Paid out or Released warranty never changes again. Holders' token accounts together hold exactly `paid_amount`.
- **I4** Only the holder moves claim rights and only the owner moves the free balance: a stranger's claim, transfer,
  escalation or withdrawal fails and leaves every shop and warranty as it was.
- **Liveness** From every non-final state, advancing the clock and sending only permissionless instructions, signed by
  a stranger, brings the reserve out of `locked`. Each exit is refused one second before its deadline and accepted at
  the first allowed second.

## Checklist

| Check | How the program meets it | Test |
| --- | --- | --- |
| Signers | Owner, holder and arbiter are `Signer` and matched with `has_one` against the shop or warranty. | `holder_and_arbiter_must_sign`, I4 walk |
| Account owner and type | Every program account is a typed `Account<…>` (owner and discriminator checked); token accounts are typed SPL accounts. | `instructions_refuse_a_warranty_paired_with_another_shop` |
| Account relations | Claim → warranty → shop is chained with `has_one`; payout checks mint, vault and holder against the shop and warranty. | `payout_refuses_another_shops_vault_or_a_foreign_token_account` |
| PDA seeds and bumps | Config, shop, vault, warranty and claim are PDAs with fixed seeds; stored bumps are reused. | attack tests |
| Payout destination | The holder's associated token account for the shop's mint, derived in the program (created if missing). | `payout_refuses_a_fake_mint_and_a_non_ata_destination` |
| Arithmetic | Every add and subtract on balances, counters and deadlines is checked; the two plain subtractions follow an explicit `<=` check. | `extreme_windows_and_amounts_fail_closed_instead_of_wrapping` |
| No re-creation | Every record is created with `init` at a PDA that includes a counter (warranty id, claim index), so nothing can be re-initialised. | I3 walk |
| Token program and mint | Classic SPL Token only (`Program<Token>`); `transfer_checked` everywhere; a shop's mint must be in `Config.allowed_mints` at creation. | `deposit_from_a_token_account_of_another_mint_is_refused` |
| Double payment | Each payout path requires a non-final claim or warranty status and sets a final one in the same instruction. | `a_reserve_is_paid_once_whatever_route_is_tried_next` |
| Former holders | After `transfer_holder` every right moves to the new key. | `a_former_holder_loses_every_claim_right` |
| Clock | All deadlines compare against `Clock::unix_timestamp`; tests set the clock instead of sleeping. | dispute, dormant and liveness tests |
| Pause | `paused` is read only by `create_shop` and `issue_warranty`; no claim, payout or release instruction reads it. | `pause_blocks_new_shops_and_warranties` |

## Known limits

These are design limits, stated so nobody mistakes them for guarantees.

- **The arbiter is trusted, and the shop picks it.** The shop names its arbiter at creation (or takes the config's
  default). The program only refuses the owner's own key and makes sure an arbiter who does nothing loses to the
  dispute timeout. A shop could name a key it controls through someone else. The arbiter's address is public in the
  shop account; the warranty page does not show it yet.
- **`init_config` is taken by its first caller.** It is not tied to the program's upgrade authority. The deploy script
  calls it in the same run as the deploy and stops unless the config's admin is the deploy key; on devnet it is.
- **Upgrade authority and admin are one key.** That key can change the program. It cannot move a shop's money through
  the current program, but an upgrade could. A mainnet version would need a multisig or a frozen program.
- **The admin's limits apply to live warranties.** `set_config` changes the dispute timeout, claim cooldown and claims
  per warranty for every shop at once. It cannot touch balances, holders or a shop's own windows.
- **If no keeper runs, the money waits.** Every exit is permissionless, so anyone (the buyer through the warranty page,
  or anyone with a wallet) can send it; but somebody has to. Nothing expires in the meantime: a dormant shop's reserves
  stay owed to their holders.
- **The card is a bearer key.** Whoever holds the card's key holds the warranty. `transfer_holder` moves it to a new key
  only while the old key is still available.
- **Fields reserved for later.** `Config.assessor`, `Shop.flags` and `Claim.attest_verdict` / `attest_at` exist in the
  account layout. The admin sets `assessor`; the others are written as zero; no instruction reads any of them yet. They are there so a later version can add an
  assessor's attestation without migrating accounts.
- **The relayer spends its own SOL.** It pays fees, the rent of claim records (never reclaimed in this version) and the
  rent of a holder's token account created on payout. A holder can later close that account and keep the rent, so each
  payout can cost the relayer about 0.002 SOL. Per-signer, per-IP and daily quotas and a daily budget for
  rent-paying actions bound it ([ADR 0009](decisions/0009-relayer-and-sessions.md),
  [ADR 0021](decisions/0021-security-review-fixes.md)); new keys are cheap, so the IP and daily limits are what hold.
- **The reserve is a bond, not insurance.** A holder is paid at most the reserve the shop locked for that warranty.
- **Devnet only, no audit.**

## Review

Reviewed on 2026-11-25: the program (`programs/kekal/src`) and the fee relayer with its session routes
(`apps/web/src/lib/relay`, `apps/web/src/app/api`). The review was AI-assisted: a separate model instance read the
code with no access to these notes and reported findings, which were then checked against the code here. It is not an
audit. Fixes are in [ADR 0021](decisions/0021-security-review-fixes.md); each has a test that fails on the old code.

No finding lets anyone take a reserve that is not theirs, pay one twice, or leave one stuck.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| M1 | Medium | Claim records and payout accounts are created with the relayer's rent, which is never returned, and only the global daily cap bounded it. A holder could repeat claims to drain the relayer. | **Fixed**: every Kekal instruction that names the relayer as rent payer counts toward `accountCreatesPerDay`. |
| M2 | Medium | Transactions that pass the policy but fail on chain still spend the global daily quota; with a fresh IPv6 address per request, one caller could use it up. | **Partly fixed**: IPv6 callers are limited per /64. Open: a failing transaction still spends quota (simulating before charging is a candidate). |
| M3 | Medium | `X-Real-IP` is believed as the peer. A caller who reaches the app port directly, or a proxy that passes the header through, lets the caller pick its own rate-limit bucket. | **Not exploitable as deployed**: the containers publish no port, and the reverse proxy replaces `X-Real-IP` with the connecting address. Written down as a deployment requirement in `web.clientIp`. |
| M4 | Medium | The sign-in message took its domain from the request's Host header, so a look-alike site could get a message that names itself and relay the signature. | **Fixed**: the domain comes from the configured site URL. |
| L1 | Low | The admin's `set_config` changes the dispute timeout, claim cooldown and claims per warranty for live warranties. | **Recorded** (see Known limits). A later version would copy these into each shop or warranty at creation, or bound them. |
| L2 | Low | `init_config` is taken by its first caller, and the admin cannot be rotated. | **Recorded**. The deploy script calls it in the same run and checks the admin; a later version would require the upgrade authority. |
| L3 | Low | A shop's dormancy starts when someone declares it, not when its silence deadline passed. A warranty that expires between the two can still be released to the shop. | **Recorded, mitigated**: the keeper declares lapsed shops dormant before it sends any release, every pass. The fix (compare against the silence deadline) needs a program upgrade. |
| L4 | Low | Routes checked only the declared Content-Length; a chunked body with no length was read in full. | **Fixed**: bodies are read with a hard byte limit. |
| L5 | Low | The number of signers in a relayed transaction was not capped; the relayer pays the fee per signature. | **Fixed**: `maxSigners` (3, relayer included). |
| I1 | Info | `pay()` does not itself check the warranty status; it relies on every caller requiring an open claim or an active warranty. | Recorded; covered by `a_reserve_is_paid_once_whatever_route_is_tried_next`. |
| I2 | Info | A shop can name as arbiter a second key it controls. | Recorded (see Known limits). |
| I3 | Info | Signing out clears the cookie but the server keeps no revocation list; a stolen cookie works until it expires (`web.session.ttlSecs`). | Recorded. |
| I4 | Info | A code comment said every rate bucket is charged; the limiter stops at the first bucket over its limit. | Fixed (comment). |

Checked and found sound: account types and owners on every program account; the claim → warranty → shop chain on
every claim instruction; payout mint, vault and holder against the shop and warranty; owner instructions derive the
shop from the owner's seeds; only the shop's own arbiter resolves a dispute; at most one live claim per warranty and
every exit from Claimed ends in a final claim state; deadlines compare with `<=` on one side and `>` on the other, so
windows never overlap; checked arithmetic with overflow checks on; distinct PDA seed prefixes; classic SPL Token only;
the relayer only at index 0 and in the named rent-payer slots, no lookup tables, no compute-budget, system or nonce
instructions; signatures verified before any quota is spent; timing-safe cookie MAC; nonces burned in one SQL
statement on every attempt.
