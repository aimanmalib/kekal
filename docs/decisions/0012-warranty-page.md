# ADR 0012: Warranty page and read-only check

- Status: accepted
- Date: 2026-11-23

## Context

The buyer opens `/w/<warranty address>` from a printed QR code, usually on a phone. The page must show the reserve, the
deadline and the shop's promise, prove the promise text is the one the warranty was issued with, list what has happened,
and let the card holder act (activate, claim, confirm, escalate, move paid money) with no wallet and no fees. Anyone
with only the address needs a read-only view (`/semak`).

## Decision

- **Server-rendered state.** The page reads the warranty, its shop, the latest claim and `Config` limits through the
  same RPC failover as the rest of the server, and the latest `web.warrantyPage.timelineLimit` transactions of the
  warranty. Kekal events are decoded from each transaction's logs (`parseKekalEvents` in the SDK) to label the
  timeline, find the activation time (first `HolderTransferred`) and the payout reason (`ReservePaid.claim_status`).
  Decoded finalised transactions are cached in memory per signature. A network failure renders an honest "could not
  reach the network" page; the reserve is unaffected either way.
- **Terms proof.** Terms text is stored off chain (`warranty_meta`, first write wins) and the page compares its SHA-256
  with the on-chain `terms_hash`, byte for byte and then as canonical JSON, and says "matches", "does not match" or "not
  kept on this site". Demo warranties now carry readable terms (`demoTerms` in config: product and the shop's own
  install-and-service promise, in English and Malay) and the demo routes record them.
- **Card key.** The key stays in the URL fragment (`#k=<base58 seed>`), which browsers never send to the server. First
  activation generates a new seed in the browser, sends `transfer_holder` signed by the printed key through the
  relayer, keeps the new seed in `localStorage` and shows the new card link once; the fragment is then removed from the
  address bar. A printed key that no longer holds the warranty shows a "take the card back to the shop" warning.
- **Actions.** Buttons mirror the program's checks (pure `holderActions`), and every transaction is built in the
  browser, signed by the holder key and paid by the relayer. Steps anyone may send (15 to 20) appear once due; the
  visitor's holder key, or a throwaway key, co-signs as an extra read-only account so the relayer's "never sign alone"
  rule holds. A unit test runs every button's transaction through the real relay policy.
- **Claims.** Only `sha256(canonical {v, issue, description})` goes on chain; the text stays with the buyer. Showing
  claim text to the shop belongs to the merchant board.
- **`/semak`.** Accepts an address or a full card link; the browser drops any fragment before navigating, so a pasted
  key never reaches the server, and the page opens read-only. Camera scanning is not offered: the barcode API is
  missing in iOS Safari, and the phone camera already opens the link.
- Warranty pages send `noindex`. Words like blockchain, wallet and token appear only inside "Technical details"; a
  markup test enforces it in both languages.

## Consequences

- No new dependency: the browser builds instructions with the SDK and talks only to `/api/rpc` and `/api/relay`.
- A card activated in one browser is held by that browser's storage plus the link shown once; losing both loses the
  card. The page says so when it shows the link.
- `scripts/page-fixtures.ts` issues sample warranties on a running local validator with stored terms and throwaway keys,
  for browser checks.
