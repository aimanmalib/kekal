# ADR 0025: The warranty page loads the Anchor client on demand

- Status: accepted
- Date: 2026-11-25

## Context

`/w/<address>` is the page a buyer opens from the QR code, usually on a phone. Most visits only read the card, yet the
page shipped the Anchor client, the program's IDL and the SPL token helpers with its first load (1.22 MB of script,
362 KB gzip, `docs/MEASURED.md`).

## Decision

- **Instruction building moves behind a dynamic `import()`.** `HolderPanel` fetches `lib/warranty/actions` and the new
  `lib/warranty/program` (the offline Anchor program and the holder-field read) the first time it builds an action or
  reads a balance. `lib/warranty/client` keeps only the card key, the relayer round trip and RPC reads, and no longer
  imports the SDK.
- **The card seed's base58 codec is the public key type's.** A seed is 32 bytes, so `PublicKey` encodes it and rejects
  any other length, as the old check did, without pulling Anchor's `bs58` export.
- **The SDK declares `"sideEffects": false`**, so a page that imports one helper does not keep every module behind the
  package's index.

## Consequences

The first load of `/w` is about a sixth smaller (numbers in `docs/MEASURED.md`, measured with `scripts/page-weight.ts`).
The first action on the page waits for one extra chunk. Pages that build transactions as soon as they open (`/demo`,
`/kedai`, `/timbang`) import `lib/warranty/program` directly and are unchanged.
