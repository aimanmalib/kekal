# ADR 0020: The demo video is cut by a script from a scene list, and measured before use

- Status: accepted
- Date: 2026-11-25

## Context

ADR 0019 records the footage and the narration. Editing them by hand in a video editor would have to be redone after
every re-recording, and nothing would check the result: length, a missing or silent audio track, or narration that is
too quiet or clips.

## Decision

- **A scene list drives the cut.** `scripts/video/demo-cut.json` lists each scene in order: clip, in and out points,
  speed, optional crop, length, the narration lines that start in it and a short label. A scene played faster than real
  time says "sped up" in its label (a test checks this). Phone clips sit in a drawn bezel on the site's paper colour;
  desktop and terminal clips fill the frame.
- **`scripts/video/assemble.py build`** encodes the scenes, places each narration line at its offset, levels the
  narration to a target mean loudness with a peak limiter, and burns English subtitles split from the narration text.
  It also writes the same subtitles as `.srt`. Colours come from the site's tokens and text uses the site's fonts.
- **The cut is checked twice.** Before encoding, `scripts/video/cut.py` rejects overlapping lines, a line missing or
  placed twice, a line running past the end, or a video over the length limit. After encoding, `measure` checks the
  file: length under the limit, an audio track as long as the video, mean and peak loudness within the limits in the
  cut file. The program-address scene reads the address from `config/app.json`.

## Consequences

Re-cutting after new footage is one command. Timing rules are unit-tested without media. The footage and the narration
are not in the repository, so the cut is rebuilt on a machine that has them.
