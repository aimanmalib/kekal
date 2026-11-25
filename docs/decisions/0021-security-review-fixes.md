# ADR 0021: Fixes from the security review of the program and the relayer

- Status: accepted
- Date: 2026-11-25

## Context

A code review of the program and the fee relayer ([SECURITY.md](../SECURITY.md#review)) found no way to take or
double-pay a reserve, but several ways to make the relayer pay more than intended, run out its quota, or vouch for a
sign-in it should not. The relayer on devnet holds well under one SOL, and devnet faucets are hard to reach, so
anything that drains it takes the demo down.

## Decision

Fix in the web app now, each with a test that fails on the previous code:

- **Rent the relayer pays counts against one daily budget.** Each Kekal instruction that names the relayer as rent
  payer (`payer`, `payout.payer`) now counts toward `web.relay.accountCreatesPerDay`, like a direct associated-account
  creation. Claim records are never closed (no instruction closes accounts), so that rent is not returned.
- **At most `web.relay.maxSigners` signatures per relayed transaction** (3, the relayer's included); the relayer pays
  the fee for each.
- **IPv6 callers are limited per prefix** (`web.clientIp.ipv6PrefixBits`, 64), not per address, since one network can
  rotate through many addresses. IPv4-mapped addresses count as the IPv4 address.
- **Request bodies are read with a hard limit** (`readBodyText`): Content-Length is checked first and the stream is cut
  at the limit, so a chunked upload with no length cannot make a route buffer it all.
- **The sign-in message names the site's configured host** (`KEKAL_SITE_URL` or `web.site.url`), not the request's
  Host header, so a look-alike site cannot obtain a message that names itself.

Record, not fix, the program findings: each needs a program upgrade, and none lets anyone take a reserve that is not
theirs. They are listed in SECURITY.md with their status.

## Consequences

- With 100 rent-paying actions a day, the relayer's worst-case rent loss is about 0.2 SOL a day, at the cost of
  holders seeing a generic error once the budget is gone for the day. The number is in config.
- Rolling back is a revert of the web app commit; nothing on chain depends on these checks.
