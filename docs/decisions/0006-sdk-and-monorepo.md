# ADR 0006: TypeScript SDK, hashing and the test gate

- Status: accepted
- Date: 2026-11-14

## Context

The web app, the keeper and the scripts all need the same PDAs, instruction builders, account decoding and hashes.
The spec fixes a pnpm monorepo, the Anchor 1.2.x TypeScript client and "canonical JSON → SHA-256" hashes with test
vectors, and gives `product_hash = sha256(shop ‖ serial ‖ model)` without saying how the fields are joined.

## Decision

- **pnpm workspace:** `packages/sdk`, `scripts`, and later `apps/*`. Node 22, TypeScript 5.9 (strict), ESLint 10,
  Vitest. The SDK ships TypeScript sources; consumers (tsx, Next.js) compile them. Install scripts are allowed for
  esbuild only.
- **The SDK reads the IDL JSON** (`packages/sdk/src/idl/kekal.json`, copied by `scripts/sync-idl.sh`) and wraps
  `program.methods.*` in small hand-typed builders. The generated `.ts` types are not committed: they are a second,
  very large copy of the IDL. The gate fails when the SDK IDL differs from the build.
- **Builders derive every PDA themselves** instead of letting Anchor resolve them, so each transaction the program
  accepts also proves the SDK's seeds. A unit test checks the seeds against the IDL and Anchor's own resolution.
- **Canonical JSON follows RFC 8785:** keys sorted by UTF-16 code unit, no whitespace, ECMAScript number and string
  output. Values JSON cannot round-trip (undefined, NaN, bigint, class instances, lone surrogates) throw instead of
  being dropped. Vectors were computed independently with Python `hashlib`.
- **`product_hash` length-prefixes its text fields:** `sha256(shop (32 bytes) ‖ u16 LE len ‖ serial ‖ u16 LE len ‖
  model)`, both NFC-normalised and trimmed. Plain concatenation would make ("AB", "C") and ("A", "BC") collide.
- **Permissionless schedule in one place:** `scheduleWarranty` / `scheduleShop` return the next instruction (15 to
  20) and the first second the program accepts it. Keeper, web countdowns and the lifecycle script share it.
- **Amounts are `bigint`, times are `number`** (unix seconds) in decoded accounts.
- **`scripts/lifecycle.ts`** runs paths A to E against a live cluster and checks every final state and payout.
  `scripts/localnet.sh` starts a throwaway validator on ports from `config/app.json` with 5-second windows.
- **`scripts/gerbang-ujian.sh`** is the single gate: fmt, build, IDL check, clippy, program tests, lint, typecheck,
  unit tests, and the localnet lifecycle when `KEKAL_LIFECYCLE=1` (it needs a free port range and ~30 s).

## Consequences

- A program change needs `anchor build` then `scripts/sync-idl.sh`, or the gate fails.
- Undo: generated types can replace the hand-typed builders later without changing callers' inputs.
