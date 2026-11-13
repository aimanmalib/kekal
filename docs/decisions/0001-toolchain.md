# ADR 0001: Toolchain versions

- Status: accepted
- Date: 2026-11-13

## Context

The program must build the same way on the development machine and in CI for the whole event. Anchor 2.0 is still a release
candidate, so we stay on the stable 1.x line and pin every tool that changes the output.

## Decision

| Tool | Version | Where it is pinned |
|---|---|---|
| Anchor CLI and `anchor-lang` | 1.2.2 | `Anchor.toml` `[toolchain] anchor_version`, `programs/kekal/Cargo.toml` |
| Solana CLI (Agave) | 4.3.2 | `Anchor.toml` `[toolchain] solana_version` |
| `cargo-build-sbf` / platform-tools | 4.4.0 / v1.57 (SBF rustc 1.95.0, `sbpfv3`) | shipped with the Solana CLI above |
| Host Rust (tests, IDL build) | 1.89.0 | `rust-toolchain.toml` (from the Anchor template) |
| LiteSVM (program tests) | 0.15.0 | `programs/kekal/Cargo.toml`, `Cargo.lock` |
| Node.js | 22 LTS | `.nvmrc` (added with the TypeScript workspace) |
| Package manager | pnpm | `Anchor.toml` `[toolchain] package_manager` |

The workspace was created with `anchor init` using the default template (multiple files, LiteSVM Rust tests). Program tests
run in-process on LiteSVM with the clock set directly, so time-based rules are tested without waiting.

The Anchor CLI binary is the official 1.2.2 release asset for `x86_64-unknown-linux-gnu`, installed in the layout `avm` uses.
Building `avm` from source is not required to reproduce the build.

## Verified (2026-11-13)

- `anchor build`: exit 0; `kekal.so` 127,816 bytes; IDL written to `target/idl/kekal.json`.
- `cargo test`: template test `test_initialize` passes on LiteSVM.

## Fallback

If the build or the template tests fail for more than four working hours: move to Anchor 1.1.x with the Solana CLI it pairs
with; if that also fails, write the program in plain Rust with Borsh. Each step gets its own ADR.
