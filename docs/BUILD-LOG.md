# Build log

One line per step, newest last. Dates are UTC.

- 2026-11-13: Repository skeleton: README, MIT license, name check (ADR 0000), domain `kekal.sasateguh.com` pointed.
- 2026-11-13: Registered as a Dev3pack Global Hackathon entry; read the public event page and FAQ (open source mandatory, video under 3 minutes, AI tools allowed, before/during disclosure in README).
- 2026-11-13: Anchor 1.2.2 workspace from the default template; `anchor build` and the LiteSVM template test pass; toolchain pinned (ADR 0001).
- 2026-11-13: Program accounts, errors and events; instructions 1 to 8 (config, shop, deposit, withdraw, issue, heartbeat) with LiteSVM tests on a fixed clock (ADR 0002).
- 2026-11-13: Instructions 9 to 14 (transfer holder, file claim, respond, confirm, escalate, resolve dispute) with a shared payout path and LiteSVM tests on the Appendix A time boundaries (ADR 0003).
- 2026-11-14: Instructions 15 to 20 (settle unanswered, close stale, settle stale dispute, declare dormant, claim orphan, release expired); all 20 instructions present, 57 LiteSVM tests (ADR 0004).
- 2026-11-14: Property tests: seeded random walks check invariants I1 to I4 after every step (4 seeds x 200 steps), liveness from every non-final state, the claim_orphan / release_expired race in both orders, and program attacks; 72 LiteSVM tests (ADR 0005).
- 2026-11-14: pnpm monorepo with the TypeScript SDK (PDAs, 20 instruction builders, decoders, permissionless schedule, canonical JSON hashes with vectors), config and locales, one test gate script, and a lifecycle script that ran paths A to E on a local validator (ADR 0006).
- 2026-11-14: Decision index `docs/DECISIONS.md` listing ADRs 0000 to 0006 with title and status.
- 2026-11-15: `scripts/sweep-target.sh` removes cargo artifacts in `target/` unused for `targetSweep.keepDays` days (`config/build.json`, default 3) with cargo-sweep 0.8.0, skips while a build holds the cargo lock; tests run in the test gate (ADR 0007).
- 2026-11-15: First real sweep of `target/` (6761 MB before and after: no artifact older than 3 days yet; `target/deploy` unchanged, rebuild and clippy fully fresh) and a daily host cron entry for the sweep at 19:40 UTC.
- 2026-11-18: Three scheduled sweeps ran (16, 17, 18 Nov, 19:40 UTC, no errors; `target/` 6761 MB to 6749 MB); ADR 0007 notes that stale artifacts are found by fingerprint atime, not by `deps/` file atime.
