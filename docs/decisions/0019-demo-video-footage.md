# ADR 0019: Demo video footage comes from the browser tests, narration from a stock voice

- Status: accepted
- Date: 2026-11-25

## Context

The demo video has to show the real product, not slides, and it has to have a voice. The same flows the video needs
(path B, path C, the shop board, the buyer's phone) are already driven end to end by the Playwright tests on a local
validator. Hand-recording a screen would drift from what the tests prove and is hard to repeat after a change.

## Decision

- **Footage is recorded by the e2e run.** `scripts/e2e.sh` with `E2E_VIDEO=<dir>` records one `.webm` per page,
  named `<project>-<step>.webm`; `E2E_SLOWMO_MS` slows each action so it can be followed by eye. WebKit (iPhone 13)
  films at twice the viewport (`E2E_VIDEO_SCALE`), Chromium at the viewport size. `e2e/tests/film.spec.ts` adds a calm
  read of the home page and is skipped unless `E2E_VIDEO` is set.
- **Terminal shots replay real output.** `scripts/video/terminal.py record` stores each output line of a command with
  its time; `render` draws them in the site's colours at their recorded times, marks a faster clip as "sped up", and
  ends on the sum of the runner's own pass and fail counts.
- **Narration is a synthetic stock voice, run locally.** `scripts/video/narrate.py` reads the script with Kokoro
  (open weights, Apache-2.0) through `kokoro-onnx`: no account, no external service, no cloned voice. It writes one
  audio file per line and their timings for the editing step. The video and the README say the voice is synthetic.

## Consequences

Re-filming after a layout change is one command per browser. Clips from a local validator show local labels; the
explorer and program-address shots are filmed again once the site runs on devnet. The voice is clearly synthetic;
a recorded human voice can replace `narration.wav` later without touching the footage.
