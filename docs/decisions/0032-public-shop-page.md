# ADR 0032: Public shop page

- Status: accepted
- Date: 2026-11-27

## Context

A buyer meets a shop before a warranty exists. Until now the only views of a shop were its own board (`/kedai`, wallet
needed) and the warranty page after a sale. Nothing let a buyer check a shop's reserve before paying.

## Decision

- `/kedai/<owner>` shows one shop's public record: reserve locked for buyers and free, live and issued warranties, amount
  paid to buyers, last check-in and the next one due, the claim windows and the arbiter. Every figure links to the
  account that holds it on the explorer (the vault for money, the shop account for counts, times and windows).
- Data comes from the same `readShopBoard` read the board uses; claims and card holders are left out. Reads are kept for
  `web.shopPage.cacheSecs` per owner (at most `cacheMax` owners), including "no shop here", so a link printed on a
  quote cannot turn every visit into a program scan on the public RPC. Network errors are not cached.
- A bad address or an address with no shop gets a designed page with status 404.
- A quote slip (the card's engraved band and double frame around a QR code of the page) and a print button; the print
  stylesheet keeps only the slip.
- The warranty page and the shop board link to it. No program change.

## Consequences

Figures can be up to `cacheSecs` old. The page shows what the chain says and nothing else: no shop names, no ratings.
