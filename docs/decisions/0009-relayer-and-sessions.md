# ADR 0009: Fee relayer and wallet sessions

- Status: accepted
- Date: 2026-11-22

## Context

Buyers hold a card key, not SOL (PRD 4.3). Someone has to pay their transaction fees and the rent of new accounts,
without that payer becoming a key anyone can spend from. Sellers and arbiters use a standard wallet and need a server
session that proves which key they hold.

## Decision

- **`POST /api/relay {tx}`** takes a base64 transaction the holder already signed, with the relayer as fee payer
  (account 0). At least one key other than the relayer must sign: a caller of a permissionless instruction adds
  its own key as an extra read-only signer (the program ignores it). The server signs and sends only when every
  instruction is one of:
  - a Kekal instruction named in `web.relay.allowedInstructions` (holder instructions 9, 10, 12, 13 and the
    permissionless 15 to 20), matched by IDL discriminator;
  - SPL `TransferChecked` of a non-zero amount of an allowed mint out of the signer's own associated account, with
    exactly four accounts (no multisig). Unchecked `Transfer` and Token-2022 are refused because the mint is not
    checked or not supported;
  - associated-account creation (plain or idempotent) for an allowed mint at the derived address, only for the
    account a `TransferChecked` in the same transaction pays into, and at most `web.relay.maxAccountCreates` per
    transaction. Kekal payouts create the holder's account inside the program, so no other creation is needed.
- **The relayer key may stand only as fee payer and in the account slots named in `web.relay.payerAccounts`**
  (`payer`, `payout.payer`: rent for claims and payout accounts). Anywhere else, including extra accounts appended to
  an allowed instruction, the transaction is refused. Address lookup tables are refused so every key is visible.
- **Every other signer must already have a valid signature** over the exact message; the server checks Ed25519
  before it spends quota or signs.
- **Limits are fixed windows in the store:** per signer per hour, per client IP per hour, global per day, and
  associated accounts paid for per day (`web.relay`). A refused transaction spends no quota; a rate-limited one does.
- **Client IP** is the reverse proxy's peer (X-Real-IP, else the last X-Forwarded-For hop). The CDN header is
  believed only when that peer is inside the CDN ranges in `web.clientIp`, so a caller cannot pick its own bucket.
- **Sessions:** `POST /api/session/nonce {pubkey}` stores a one-time challenge (5 minutes) whose message names the
  domain, wallet and nonce in the reader's language; `POST /api/session` checks the wallet's signature over that
  stored message, burns the nonce (also on a wrong signature) and sets an httpOnly, SameSite=Lax cookie
  `<pubkey>.<expires>.<HMAC-SHA256>`. `KEKAL_SESSION_SECRET` (32+ characters) signs it; without it the session
  endpoints answer 503. The cookie proves the key, not a role: each page checks the key against the shop or
  arbiter account on chain.
- Server keys are read from `KEKAL_KEYS_DIR` (or the cluster `keysDir`) by role name; errors never include contents.

## Consequences

- The relayer can lose SOL through fees, the rent of accounts the program creates, and the rent of associated
  accounts a transfer pays into. The owner of such an account can later empty and close it to reclaim that rent, so
  each one is a possible loss of about 0.002 SOL; `accountCreatesPerDay` caps it per day, and a transfer needs a
  non-zero balance of an allowed mint, which on devnet only the project's own mint key issues.
- The per-signer limit slows a single key, not someone who makes new keys; the per-IP and daily limits bound that.
- A `TransferChecked` passes for any key that holds an allowed mint, not only a current warranty holder; the policy
  reads no chain state, so it cannot tell. The cost is a fee within the same limits.
- Sending through every RPC URL in turn is safe because the signed bytes, and so the signature, are the same.
- Adding a relayed instruction is a config change plus a policy test; a new account slot for the relayer needs a
  `payerAccounts` entry.
