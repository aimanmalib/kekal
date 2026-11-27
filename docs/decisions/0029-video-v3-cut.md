# ADR 0029: Third video cut: zoomed product, measured silence

- Status: accepted
- Date: 2026-11-27

## Context

The second cut (ADR 0024) put a whole phone screen in the middle of a 1920 x 1080 frame, so the product filled about a
quarter of the width and its text could not be read on a small player. Narration covered about 60% of the running time:
seven stretches without a voice added up to 55 s, the longest 13 s. One short clip was held as a still for 10 s, and the
first payment appeared after a minute.

## Decision

- **Product shots are zoomed panels.** A `zoom` scene crops the action area of a clip (`crop`), scales it into a framed
  panel of at most 1100 x 880 and sets one large sentence (`side`) beside it. A `still` scene does the same for an image
  (the printed A6 card) with a slow zoom. `wide` scenes (explorer, test replay) fill the frame and must keep a 16:9 crop.
  The closing card is drawn from `closing` and `config/app.json` (site and source links).
- **Rules in the cut file, checked before the build** (`cut.look_problems`, `cut.silence_problems`, run by the unit tests
  on the committed cut): every product scene declares a crop and fills at least 45% of the frame width; no clip is held
  past its end for more than 0.5 s; the planned narration leaves no gap over 3 s and silence (gaps of 1.5 s or more) is at
  most 20% of the video. The narration line lengths the cut was timed against are stored in the cut file; the build stops
  if the voice folder differs.
- **The finished file is measured, not trusted**: `assemble.py measure` adds ffmpeg `silencedetect` (-35 dB, 1.5 s) and
  `freezedetect` (-60 dB, 4 s) to the length and loudness checks.
- **Speed-ups and cuts are labelled on screen**: the answer countdown plays 8x, the check-in countdown 24x, and the label
  of path C says that two refused retries were cut. The first scene says the narration is a synthetic voice.
- **The first eight seconds stand alone**: the button press, the payment and the explorer's "25 tokens" come first.
- `assemble.py preview` renders one still per scene so crops can be checked in a minute instead of a full build.

## Consequences

The v2 cut fails these rules and the v3 cut passes them. A new narration line (for example about a feature built during
the event) needs a scene, a place in the timeline and its length in the cut file, or the build stops.
