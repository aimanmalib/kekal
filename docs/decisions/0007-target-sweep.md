# ADR 0007: Sweeping old cargo artifacts from target/

- Status: accepted
- Date: 2026-11-15

## Context

Every cargo or Anchor build with other features, flags or a re-pinned lock file leaves a new copy of each crate in
`target/` (different metadata hash) and nothing ever removes the old ones. Two days of work grew `target/` to about
6.7 GB, `target/debug/deps` alone 5.7 GB with dozens of copies of the same crates. `cargo clean` would also remove
the current build (the next gate rebuilds everything) and `target/deploy` holds the program keypair, i.e. the program
id. Cargo's own artifact GC is nightly only and the repository pins stable 1.89.

## Decision

- **cargo-sweep 0.8.0** (MIT, `cargo install cargo-sweep --locked --version 0.8.0`) run by
  `scripts/sweep-target.sh` as `cargo sweep --time <keepDays>`.
- **The threshold lives in `config/build.json`** (`targetSweep.keepDays`, integer 1 to 30, default 3; `0` disables
  the sweep). Three days covers a weekend without a rebuild and caps growth at a few days of builds. Anything else is
  a configuration error (exit 2).
- **What cargo-sweep measures (read from the 0.8.0 source):** for each `<profile>/.fingerprint/<crate>-<hash>/`
  directory it takes the newest **access time** (atime) of the files inside; hashes not used within the threshold are
  removed from `<profile>/.fingerprint`, `deps`, `build`, `native` and the profile directory. Only names of the form
  `<name>-<16 hex>` are touched, so `target/deploy`, `target/idl`, `target/types` and `incremental` are left alone.
  Cargo reads the fingerprints of every unit on each build; with `relatime` mounts atime still advances at least once
  a day, which is enough for a threshold in days. The tests age fixtures on both atime and mtime.
- **No sweep during a build (measured):** cargo holds an exclusive `flock` on `<profile>/.cargo-lock` (newer cargo
  also `.cargo-build-lock` / `.cargo-artifact-lock`) while it builds; cargo-sweep takes no lock and completes while
  that lock is held by someone else. The script takes every such lock non-blocking before sweeping: if one is held it
  prints `skipped: build in progress` and exits 0; otherwise it keeps them for the whole sweep, so a build that starts
  meanwhile waits ("Blocking waiting for file lock") instead of racing the removal.
- **cargo-sweep 0.8.0 logs some failures but still exits 0**, so the script fails (exit 1) on any `[ERROR]` or
  `[WARN]` line.
- **Schedule:** a daily host crontab line, not a step in the test gate (the gate must stay deterministic and sweeping
  during it could race its own builds). The script sets its own `PATH` so it runs under cron's `/usr/bin:/bin`.
- **Tests:** `scripts/test/sweep-target.test.sh` builds a dependency-free crate twice (feature on, then off),
  ages the first build, and checks that the old build goes, the current build stays and is not rebuilt, deploy /
  idl / types files keep their hashes, a longer threshold removes nothing, `0` disables, a held lock skips, and a bad
  config exits 2. The test gate runs it and fails when cargo-sweep is missing.

## Consequences

- `target/` stays at roughly `keepDays` days of builds; incremental caches are not swept.
- Files in `deps/` can keep an old atime while their unit is still current: a fresh unit is only checked through its
  fingerprint, and its `.rlib`/`.rmeta`/`.so` are read again only when something links or recompiles against them.
  To find stale artifacts, check fingerprint directories (the signal cargo-sweep uses), not `deps/` file atimes.
  Measured after three scheduled runs: 331 `deps` files (1108 MB) with atime older than 4 days, every one belonging to
  a fingerprint read within the last 4 days; no fingerprint directory was older than the threshold.
- Undo: set `keepDays` to `0`, or remove the host crontab line tagged `kekal-target-sweep`.
