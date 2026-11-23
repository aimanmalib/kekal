# ADR 0014: Shop and arbiter boards

- Status: accepted
- Date: 2026-11-23

## Context

A shop needs to lock a reserve, show it is still open, issue printed cards and answer claims; an arbiter needs to rule
on disputed claims. Both use their own devnet wallet. The buyer's side (card key, relayer) is already settled in ADR
0009 and 0012; the home page needs live figures and a way into the no-wallet demo.

## Decision

- **Wallets through the Wallet Standard directly** (`@wallet-standard/app`): every standard wallet (Phantom, Solflare,
  Backpack and others) registers itself; the board lists those that offer `standard:connect` and
  `solana:signTransaction` for the site's cluster. No wallet-adapter UI kit: one connect button per wallet is enough.
- **The wallet signs and pays; the server only broadcasts.** The browser builds the transaction (blockhash from
  `/api/rpc`), the wallet signs it, and `POST /api/submit` sends it through the same RPC failover list. The server adds no
  signature. It accepts only the seller and arbiter instructions in `web.submit.allowedInstructions`, idempotent
  associated-account creation and compute-budget instructions, at least one Kekal instruction, every signature present
  and valid, no server key anywhere in the message, and a per-IP hourly limit. Holder instructions stay on the relayer.
- **Terms text is accepted by its hash, not by sign-in.** After issuing, the board posts the canonical terms JSON to
  `POST /api/terms`; it is kept (first write wins) only if its SHA-256 equals the warranty's on-chain `terms_hash`. A
  forged text cannot match, so the wallet session cookie of ADR 0009 is not needed for this.
- **Cards.** Issuing makes a fresh card key in the seller's browser, issues the warranty to it with a heartbeat in the
  same transaction, and offers the card link, a QR preview, a PNG card per language (canvas, the page's fonts) and one
  A6 PDF with an English and a Malay page (`pdf-lib`, standard PDF fonts). One layout feeds both files. The key is never
  stored or sent to the server; the board says to print the card before leaving the page. Characters the standard PDF
  fonts cannot print are replaced; the full text stays on the warranty page.
- **New shops take the claim windows in `web.shopBoard.windows`** (fixed at creation, checked against the cluster limits
  on chain) and the configured default arbiter. Term lengths, the starting reserve and the default promise text come from
  config; the promise is editable per card in both languages.
- **Claims on the board show state and deadline, not the buyer's text.** The program stores only a fingerprint of the
  claim; the buyer's description stays with the buyer. The shop's answer is fingerprinted the same way.
- **`/timbang` lists claims in `Disputed`** whose shop names the connected wallet as arbiter, with the dispute timeout
  after which the buyer can be paid without a ruling. The arbiter's wallet pays any account rent of the payout.
- **Home page figures** (shops, warranties running, reserve locked, claims paid) come from program account scans, cached
  `web.home.statsCacheSecs` and left out when the read takes longer than `web.home.statsTimeoutMs`. Repository and video
  links appear only once `web.home.repoUrl` / `videoUrl` are set.

## Consequences

- A shop needs devnet SOL for fees and some of the reserve currency (kUSD or devnet USDC) in its wallet; the board says so
  when a send is refused.
- `/api/submit` is a public broadcast endpoint for a narrow set of instructions; the limit is per IP, like the relayer's.
- Rollback: remove the `/kedai` and `/timbang` routes and `/api/submit`; nothing on chain depends on them.
