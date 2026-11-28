# ADR 0035: Fourth video cut: the public shop page, and a re-filmed home page

- Status: accepted
- Date: 2026-11-28

## Context

The third cut (ADR 0029) was made before the public shop page (ADR 0032) existed and before the home page's first screen
changed, so the video showed neither the feature built during the hackathon nor the current first screen. Its
loudness was -19.3 LUFS integrated, quieter than most players expect.

## Decision

- **One new scene, about 8 s**: the public shop page `/kedai/<owner>` of the showcase shop on devnet, filmed in WebKit at
  iPhone 13 size on the public site (`film live: the public shop page on a phone`, page from `liveFootage.shopPage`),
  read from its reserve down to the claim windows at 2x. Its label says it was built during the hackathon. A new
  narration line (9 of 12) goes with it, read by the same stock synthetic voice; the other eleven lines are unchanged.
- **The home page scene is re-filmed** from the public site, so it shows the current first screen.
- **The path C label is the plain "Live on Solana devnet"**. The cut still removes the two "not due yet" retries that
  the chain refused while its clock caught up with the countdown; this ADR records that.
- **Louder mix**: `audio.targetMeanDb` goes from -20.5 to -18.0 dB mean (-16.9 LUFS measured), still inside the
  -23 to -17 dB range in `rules`; the limiter keeps peaks at -2 dB.
- The cut stays under 110 s. Silence and freeze rules from ADR 0029 are unchanged and pass on the finished file.
