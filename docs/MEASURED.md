# Measured

Every number on this page comes from a command run against the cluster named, with the raw output kept in
[`docs/measured/`](measured/). Public claims about Kekal use only these numbers.

## Program on devnet (25 Nov 2026, UTC)

| Item | Value |
|---|---|
| Program id | [`3dTk2T83xQWAat7iWDjfCzijdCQWhstUxFtwLk8HUo3X`](https://explorer.solana.com/address/3dTk2T83xQWAat7iWDjfCzijdCQWhstUxFtwLk8HUo3X?cluster=devnet) |
| Program data account | `5evFKxuStMT4fLc7vLcr5CXGnQYz4Bgco83tN1YzZfn6` |
| Upgrade authority | `DtecSzuDbwsTL2MzBJtvaz6bD8qJSKbcgiPoAR8ukDvu` (the deploy key; the program can still be upgraded on devnet) |
| Deployed in slot | 526019572 |
| Deploy transaction | [`3idy6CHCiFou…`](https://explorer.solana.com/tx/3idy6CHCiFouvUajATAwEtWUzcsRPSdh21WBczhTW2jYmav66qpSowtYmAKnn3nUR6u48PT1iHb7yTwYks5TvEkM?cluster=devnet) |
| Program size | 397,232 bytes (`target/deploy/kekal.so`, account sized to this build, no extra length) |
| `.so` sha256 | `d6c9b2db362dad713d3d831e5d4bda1b9c8aa02b98d9ae161753908aead1305c` |
| Rent held by the program data | 2.0188174 SOL (`solana program show`) |
| Instructions | 20 (IDL published on chain, metadata account `HxZLfy6vPmsjaVL8BdUofcBpwa1qpQHa1QrLwN6PXBpV`) |
| Config account | [`FhGJFYUDC69arLBocgD7ngd824YqYgSo49ivrxL4soRK`](https://explorer.solana.com/address/FhGJFYUDC69arLBocgD7ngd824YqYgSo49ivrxL4soRK?cluster=devnet), created by `init_config` in the same script run as the deploy |
| `init_config` | [`YTRHq3cjCpy7…`](https://explorer.solana.com/tx/YTRHq3cjCpy7mmGuK5ssZRXsvJEJqwrm3xVABonPc1FQDCQks2hYrkHBNgMqzo2y4MrmprR7D6QvcZH2Y2QmFNb?cluster=devnet), slot 526019625, 8,229 CU; `Config.admin` = deploy key (checked by the script) |
| kUSD mint (demo stablecoin) | [`D2bmq7TYt8eVtbydmsKbi26htLtwjCVrJnXA2kdh77oA`](https://explorer.solana.com/address/D2bmq7TYt8eVtbydmsKbi26htLtwjCVrJnXA2kdh77oA?cluster=devnet), 6 decimals, mint authority = deploy key |
| USDC mint (devnet) | [`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`](https://explorer.solana.com/address/4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU?cluster=devnet), 6 decimals, address from Circle's [USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) page (Solana Devnet) |
| Leftover buffer accounts | none (`solana program show --buffers`) |

Command: `bash scripts/deploy-program.sh devnet` (deploy, `init_config`, IDL, buffer check). Raw output of the
`init_config` step: [`measured/devnet-init.json`](measured/devnet-init.json).

### On-chain bytes match the local build (25 Nov 2026, 16:05 UTC)

| Source | Executable hash (`solana-verify` 0.5.2) |
|---|---|
| Program on devnet: `solana-verify get-program-hash -u devnet 3dTk2T83xQWAat7iWDjfCzijdCQWhstUxFtwLk8HUo3X` | `2060781a9dc853211621c0aaf1881eeee7afdcb87573496f532886ef4acdf77c` |
| Local build: `solana-verify get-executable-hash target/deploy/kekal.so` | `2060781a9dc853211621c0aaf1881eeee7afdcb87573496f532886ef4acdf77c` |

The two hashes are the same: the program on devnet is the `kekal.so` measured above. That file was built with
`anchor build` (Anchor 1.2.2, pins in [ADR 0001](decisions/0001-toolchain.md)) from program sources last
changed in commit `6bc52fc`. It was not built in the `solana-verify build` container, so a different machine may produce
different bytes from the same source; this check shows the deployed program is this build, not that the build is reproducible.

## Tests at the deployed commit

From `bash scripts/gerbang-ujian.sh` on the same day: `cargo clippy -D warnings` clean, 72 program tests (LiteSVM),
55 SDK, 234 web app, 22 script, 9 keeper and 6 server package tests, all passing.

## Paths A to E on devnet

`pnpm --filter @kekal/scripts lifecycle --cluster devnet` ran all five paths in 327 s with the demo shop windows
from `config/app.json` (60 s to answer a claim, 120 s heartbeat; path D uses a 300 s term). Every transaction below is a
link to the public explorer. Raw report: [`measured/devnet-lifecycle.json`](measured/devnet-lifecycle.json).

### Set-up: shared demo shop and the dying shop of path C

| Step | Transaction |
|---|---|
| `heartbeat` | [`uNwjH4kArHrPD5C8…`](https://explorer.solana.com/tx/uNwjH4kArHrPD5C8X5MHzen7Vvy9Bb9pTp2BHFNBauUxYxoPEVEPEFVKr79jg4ZftzSCfsyQEjxRTrFmuVLWpvy?cluster=devnet) |
| `deposit` | [`7ex1TPKkEBux4LSE…`](https://explorer.solana.com/tx/7ex1TPKkEBux4LSEH6Ya14oiFRQhGHN5MXgQCceVaQoqYtRQ1N8LxPogMMjX6qUqU2SH74WthMg6GaWzrU4VDF4?cluster=devnet) |
| `create_shop` | [`3Q3V4J4uU4MmuMjF…`](https://explorer.solana.com/tx/3Q3V4J4uU4MmuMjF24Gwbq3mmj6p941bJwHmBsAGD3e5uDHpFZ2rZe76kBZ64SF3VuN725KouVJ6KAJeJmkky9mg?cluster=devnet) |
| `deposit` | [`5J8TFF3Gv9A1Vd2n…`](https://explorer.solana.com/tx/5J8TFF3Gv9A1Vd2nXEVRuXRKUymcFN7MccbkRZi4jBJw9ennMEbz2he4GdGAD5r5SwzDwEeQ8rESLdoykJbXAxJk?cluster=devnet) |

### A: claim, shop accepts, buyer confirms

| Step | Transaction |
|---|---|
| `issue_warranty` | [`3H2BhpxrX3txWGB6…`](https://explorer.solana.com/tx/3H2BhpxrX3txWGB6sJQoWFJTFfwf9EkXdGaHNkJgrBKBkPgmnuMyKfw2EcniWaPym1bjnPzP5Eaa2v6seNeokXdo?cluster=devnet) |
| `file_claim` | [`AqmN4U3qWNtWxeDU…`](https://explorer.solana.com/tx/AqmN4U3qWNtWxeDU9hXP2EP1vU9WDbjCrpCxxh26HzDsiUBnsPydtGG5s5MY4fSGR9CJE6yRa74b68i7uwuvYiX?cluster=devnet) |
| `respond_claim` | [`3g121deAqsycxwJ2…`](https://explorer.solana.com/tx/3g121deAqsycxwJ2HTdU4wUUurNZKxyHmnoBAiC83BQXvS9F2QtTx1aUm7fe1UYVWP96cmXkg8cn1Z5oUjt8SEcA?cluster=devnet) |
| `confirm_resolved` | [`3ZrGT6Wjvq4fjSdY…`](https://explorer.solana.com/tx/3ZrGT6Wjvq4fjSdYWVgfuRHcjyBd89MgFnXKLbEukHBdFt91taMDJB9tEEWvDyndp5T8mY1nRVneA828xgA78gPz?cluster=devnet) |

### B: claim, shop silent, paid without the shop

| Step | Transaction |
|---|---|
| `issue_warranty` | [`2CU8rLY7qRUeXMCa…`](https://explorer.solana.com/tx/2CU8rLY7qRUeXMCa1pi5Yj3MBekgGMYyVcyDVTCo8ccgzbxHGgkFJkZf99oK3WxRh5vYDtqjCRaSVznkY1AVC9i1?cluster=devnet) |
| `file_claim` | [`3bpbrHSijPrtCqHk…`](https://explorer.solana.com/tx/3bpbrHSijPrtCqHksTLXAjGdAu9HfaQsbMVR8FCfZYweSCtuuTQvTzzwXN1Cx8jGzzGxUefrWXjWfPuiRaAEa8Yt?cluster=devnet) |
| `settle_unanswered` | [`238SqFGjHmgjPAb6…`](https://explorer.solana.com/tx/238SqFGjHmgjPAb6WX8bJz95N3gJt8FZwyYVXfroft5i2zrebW1zNa7BWiJRgjbPo4sAALJq9NvuZvytFok3mVb9?cluster=devnet) |

### C: shop stops its heartbeat, dormant, orphan claim paid

| Step | Transaction |
|---|---|
| `issue_warranty` | [`Fdm94kTgKLQEmR6C…`](https://explorer.solana.com/tx/Fdm94kTgKLQEmR6C6JbRq4YegUibrxDHHwX1Y4J3JvHWfH41yJqNG6Bm1xLaTUnMuMRUneNLwfJY8kqKpJ7MZxw?cluster=devnet) |
| `declare_dormant` | [`4H5xbBJu4dtrF8qb…`](https://explorer.solana.com/tx/4H5xbBJu4dtrF8qbx9pqScBx82XaFQZ5geRafM4hpRgj2SqL3YbfV7wqvn88ywm3MMtaGZzWCmq6ndNRyMsgp4aQ?cluster=devnet) |
| `claim_orphan` | [`45QAVYxnDc39S4rn…`](https://explorer.solana.com/tx/45QAVYxnDc39S4rnPVKbqK5szyzjePkgCF5hR94ftmauBXWZ7Eoi1eQhoUn98zJqjfgRUoHnEMBMiymxVuhvJJ8?cluster=devnet) |

### D: warranty expires, reserve returns to the shop

| Step | Transaction |
|---|---|
| `issue_warranty` | [`43kSywsteAp5baUL…`](https://explorer.solana.com/tx/43kSywsteAp5baULdztWAcycaVYRKCu99pU2puZDQb1FXDzZWZNGXCB72wHpNaSGcuKJQdjFRUZeDTg1jrbxwN8e?cluster=devnet) |
| `release_expired` | [`2Xgy9QzmGyccx1Sk…`](https://explorer.solana.com/tx/2Xgy9QzmGyccx1Skw2NAzsSajkDU8WE4PbfbakYBT9A3nXwVJACzFG6FpmTPKPAyWYE8vbVHtTmDaBXwftBRkUR?cluster=devnet) |

### E: shop rejects, buyer escalates, arbiter rules

| Step | Transaction |
|---|---|
| `issue_warranty` | [`29JXRaktVj5sLNLr…`](https://explorer.solana.com/tx/29JXRaktVj5sLNLrwVsJAnzHC9xddFtSYDeJG5gCWKRJe6HmNV4iyfytLAe2565ws8YNex5anNg4jEnhGq5gp7Fw?cluster=devnet) |
| `file_claim` | [`6iUxi6hBdmYfmHhT…`](https://explorer.solana.com/tx/6iUxi6hBdmYfmHhTmALhfWmZbtW46Wkah3UawYe4ZvDDQMvZQzbDLXetxqEgGYQyjo8KqViDfS4yy2Bjp9YuVFT?cluster=devnet) |
| `respond_claim` | [`5PJW9s2qPSChfiDq…`](https://explorer.solana.com/tx/5PJW9s2qPSChfiDqk3TQ3xXxXVgWxo7p8CpuoYacPTJ4uDXYPFrE2yyJge8pURVvo895F57t1xHMfXq214yKXGFi?cluster=devnet) |
| `escalate` | [`2AKFyqLu64P96qne…`](https://explorer.solana.com/tx/2AKFyqLu64P96qnexQ9DWct7yynvcAQJTgrCVBPwMBaZVd5KYTeu42DM7b6JNjcb3TJ5XgdJTirxv2CR6J8Nsu7c?cluster=devnet) |
| `resolve_dispute` | [`GTtBZ1kNTpnUMfuY…`](https://explorer.solana.com/tx/GTtBZ1kNTpnUMfuYZN2aDZ338yERxE1YcHJRz8MWykxanHHB3KoDEbi2YGJSPWurwmATRTpR8gmo49rkkQxmnHj?cluster=devnet) |

Path C's `issue_warranty` transaction also carries a heartbeat (the dying shop's window is 60 s), so its compute units
include both instructions.

## Live demo on the public site (25 Nov 2026, UTC)

The browser tests for `/demo` ran against [kekal.sasateguh.com/demo](https://kekal.sasateguh.com/demo) on devnet (deploy
tag `907dabc-202611251508`), once on WebKit emulating an iPhone 13 and once on Chromium desktop. Each test clicks the
scene's first button and stops when the page shows the reserve paid to the card made in that browser. No wallet, no
sign-up. Raw numbers: [`measured/live-demo.json`](measured/live-demo.json).

| Path | WebKit, iPhone 13 | Chromium desktop |
|---|---|---|
| B: claim filed, shop silent, paid | 73.9 s | 72.1 s |
| C: shop stops checking in, marked dormant, paid | 75.0 s | 76.8 s |

Most of that time is the demo shop's own windows (60 s to answer a claim; 60 s check-in with no grace), set in
`config/app.json`. Every step on the page links to its devnet transaction. The site reads devnet through three public RPC
endpoints in failover order ([ADR 0023](decisions/0023-live-site-on-devnet.md)).

## Compute units per instruction (devnet, from the transactions above)

| Instruction | Transactions | Compute units |
|---|---|---|
| `heartbeat` | 1 | 5,124 |
| `deposit` | 2 | 10,264 to 10,266 |
| `create_shop` | 1 | 27,577 |
| `issue_warranty` | 5 | 14,206 to 22,330 |
| `file_claim` | 3 | 14,604 to 16,104 |
| `respond_claim` | 2 | 7,688 to 7,691 |
| `confirm_resolved` | 1 | 7,134 |
| `settle_unanswered` | 1 | 38,056 |
| `release_expired` | 1 | 5,041 |
| `escalate` | 1 | 7,124 |
| `resolve_dispute` | 1 | 40,398 |
| `declare_dormant` | 1 | 3,272 |
| `claim_orphan` | 1 | 47,144 |
| `init_config` | 1 | 8,229 |

Command: `pnpm --filter @kekal/scripts measure-cu --cluster devnet --report <lifecycle report>`, which reads
`computeUnitsConsumed` from each transaction. Raw output: [`measured/devnet-cu.json`](measured/devnet-cu.json).

## Devnet SOL

| When | Deploy key balance |
|---|---|
| Before the deploy | 10 SOL |
| After deploy, `init_config`, kUSD mint and on-chain IDL | 7.948636125 SOL |
| After sending 0.6 SOL to the demo shop key, 0.5 to the fee relayer and 0.1 to the arbiter | 6.748621125 SOL |
| After two lifecycle runs (the first stopped on the public endpoint's rate limit; fresh dying-shop owners, token accounts, minting) | 6.684105805 SOL |
| After the showcase shop (`seed-demo`, 0.05 SOL to its owner), a third lifecycle run for `/contoh`, and sending 2 SOL to the fee relayer and 1 SOL to the demo shop key before the site went live | 3.601068925 SOL (relayer 2.46, demo shop key 1.51, after the four live demo runs) |

