# ADR 0026: Public CI runs the test gate without a local validator

- Status: accepted
- Date: 2026-11-25

## Context

The repository is public. `scripts/gerbang-ujian.sh` is the full test gate, but some of its steps need a machine set up
for this project: a local Solana validator (lifecycle paths, browser tests) and host tools (`cargo-sweep`, the video
and deploy script tests). A visitor needs a result they can check without trusting the author's machine.

## Decision

- **`.github/workflows/ci.yml` runs two jobs on every push to `main` and every pull request.** `program`: `cargo fmt`,
  `anchor build`, the IDL check (`scripts/sync-idl.sh --check`), `clippy -D warnings` and the LiteSVM program tests.
  `app`: eslint, typecheck, the SDK/server/keeper/web unit tests, the store tests on a throwaway Postgres container and
  the web build.
- **Versions come from the repository**, not the workflow: Rust from `rust-toolchain.toml`, Solana and Anchor from
  `Anchor.toml`, Node from `.nvmrc`, pnpm from `package.json` (`packageManager`, through Corepack). Actions are pinned
  to commit hashes; the token is read-only.
- **Not in CI:** the lifecycle runs on a local validator, the browser tests and the host-only script tests. They stay in
  `scripts/gerbang-ujian.sh` (`KEKAL_LIFECYCLE=1`, `scripts/e2e.sh`).
- The README shows a CI badge only because the first run passed.

## Undo

Delete `.github/workflows/ci.yml` and the README badge; `scripts/gerbang-ujian.sh` is unchanged.
