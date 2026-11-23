# AI usage

How AI was used to build Kekal, what a person decided, and how the work was checked. The short version is in the README
under [AI disclosure](README.md#ai-disclosure).

## Tools

- **Claude Code** (Anthropic), a coding agent running Claude models in a terminal on the author's own server.
  Commits written in an agent session carry a `Co-Authored-By: Claude …` trailer, so `git log` shows which commits
  came out of one. Most commits in this repository do.

## What the AI produced

Working from the author's brief, the agent wrote nearly everything in the repository:

- **Design:** the account and instruction layout, the claim and settlement windows, and the architecture decision records
  in [`docs/decisions/`](docs/decisions/).
- **Program:** the Anchor program in `programs/kekal/` (all 20 instructions).
- **SDK and scripts:** the TypeScript SDK in `packages/sdk/`, the lifecycle script, the test gate and the build housekeeping
  scripts in `scripts/`.
- **Web app:** the Next.js app in `apps/web/` (RPC proxy, fee relayer, wallet sign-in, store), with its English and Malay
  text in `locales/`.
- **Tests:** the LiteSVM program tests (including the property, liveness and attack tests), the SDK, script and web tests.
- **Documents:** the README, the build log, the design brief, the logo in `brand/`, and the diagram and terminal capture in
  `docs/media/`.

## What the author did

- Had the idea: a warranty that is still honoured after the shop that sold it has closed.
- Set the product rules and the limits: who may claim, what happens when a shop goes quiet, devnet only.
- Chose what to build next, accepted or rejected the results, and decided what goes into the entry.
- Is responsible for the project, its code and every claim made about it.

## How the work was checked

- **Tests that set the clock.** The program tests run on LiteSVM with a fixed clock, so each deadline is checked one second
  before and one second after its edge. Counts and suites are listed in the README under [Tests](README.md#tests).
- **One test gate.** `scripts/gerbang-ujian.sh` runs formatting, lint, clippy with warnings as errors, a fresh
  `anchor build`, an IDL drift check, and the program, SDK, script and web tests, then builds the web app.
- **Separate review sessions.** Changes were read by a different AI session than the one that wrote them, which looked at
  the diff and could reject it.
- **Mechanical checks before a commit:** scope checks, a scan for secrets and private paths, and file-size limits.

## Limits of this review

- **No human security audit.** Nobody outside the project has reviewed the program. AI review and tests are not an audit.
- **Devnet only.** Do not use Kekal with real money. See [Limits](README.md#limits).
- AI output can be wrong in ways tests do not catch. If you find a problem, please open an issue.
