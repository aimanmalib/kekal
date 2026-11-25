# ADR 0016: One image, a host deploy script, and an honest "program not deployed" state

- Status: accepted
- Date: 2026-11-24

## Context

The site can go online before the program is on devnet. A visitor in that window should see a clear, designed state,
not raw RPC errors, and the deploy has to be repeatable and reversible on a single shared host.

## Decision

- **Each cluster in `config/app.json` has `deployed`** (`KEKAL_PROGRAM_DEPLOYED` overrides it). It is separate from
  `programId`, whose `null` already means "the address in the SDK IDL". While `deployed` is false: every page shows one
  status line saying the program is not on the network yet; `/demo` shows what the demo will do; the home page leaves out the program address and skips reading chain figures; `/api/demo/*`, `/api/submit`
  and `/api/relay` answer 503 `program_not_deployed`; `/api/health` stays 200 with `program: "not_deployed"`.
- **No text promises what does not exist yet.** The finished examples count as present only when
  `config/examples.json` holds a run for the site's cluster. Until then `/contoh` describes how each path ends, the
  status line and `/demo` do not mention finished examples, the home page offers neither the demo nor `/contoh`, a
  warranty page says no card exists yet without asking the network, and `/kedai`, `/timbang` and the wallet picker do
  not say they run on the network or link to the closed demo. A test renders every page in English and Malay in this
  state and fails on any deployed-only text or link.
- **One image for the web app and the keeper** (`Dockerfile`): Next.js standalone output plus the keeper bundled by
  esbuild (the copy tsx already ships), so the runtime image has no TypeScript, Rust or Solana toolchain. Built from a
  clean `git archive` of HEAD, never from the working folder.
- **`deploy/deploy.sh`** (`--build`, `--status`, `--rollback`) after the pattern of keeping the previous image in a
  stopped container for rollback, removing older images of this project only, and refusing to build when the disk is
  low. Host values live in an untracked `deploy/hos.env`; `deploy/hos.env.example` lists them.
- **Compose**: `kekal-web` (1 CPU, 512 MB, read-only root, tmpfs) and `kekal-keeper` (0.25 CPU, 128 MB) in the `devnet`
  profile, so the keeper does not start against a program that is not there. No published port; names carry the
  project prefix because service names are aliases on a shared network. Keys are a read-only mount.
- **Proxy route** (`deploy/traefik.yaml.tmpl`): compression at the proxy, pages and API answers sent uncached with
  `no-transform` so a CDN in front does not rewrite them, content-hashed `/_next/static` assets keep their own caching,
  and a CSP that allows only this origin (the browser reads the chain through `/api/rpc`).
- **`deploy/smoke.sh`** runs every new image alone before the live container is replaced: default bridge network,
  read-only root, a throwaway data volume and an empty key folder. It needs `/api/health` 200 with `"ok":true` and 200
  from the pages listed in `config/deploy.json`; a failure removes the image and leaves the live site untouched.
- **`deploy/uptime.sh`** checks `/` and `/api/health` (including `"ok":true`) every few minutes and alerts once after
  two failures in a row.

## Consequences

Turning the program on after the devnet deploy is a config change (`deployed: true`, program ID, mint) plus enabling
the keeper profile. Rollback is `deploy/deploy.sh --rollback`. The shell tests in `scripts/test/deploy.test.sh` cover
the uptime alerts, the smoke test and the proxy route template.
