# ADR 0013: Guided demo and finished examples

- Status: accepted
- Date: 2026-11-23

## Context

A judge opens the site on a laptop with no wallet and a few minutes. They need to see a reserve reach a buyer in the
two cases that matter most (the shop ignores a claim, the shop closes), with every step as a public transaction, and
they need a way to see all five paths without waiting.

## Decision

- **`/demo` runs two scenes in the browser.** Each makes a throwaway card key, asks `/api/demo/session` ("the shop goes
  silent", path B) or `/api/demo/dying-shop` ("the shop closes", path C) for a warranty to it, then follows the
  warranty through `GET /api/warranty/[pda]`, the same read-only view `/w/[pda]` renders. Polling (`web.demoPage.pollMs`)
  runs only while a deadline counts down.
- **The scene is derived from chain state, not a script.** A pure `scenePhase` turns the view and the chain clock into
  the next move: file a claim, count down, press the step anyone may send, or paid. If the keeper sends the step first
  the scene simply moves on, and a failed send is not reported when the warranty is paid anyway.
- **Steps are the warranty's own transactions**, oldest first, each with the event name, one sentence and its explorer
  link. Marking a shop silent touches only the shop, so for a silent shop the reader merges that transaction in from the
  shop's recent history; `/w/[pda]` shows it too.
- **The key is kept where `/w/[pda]` looks for it**, and the scene's warranty address in `web.demoPage.storageKey`, so a
  reload resumes and "Open the warranty page" shows the holder view.
- **`/contoh` renders a lifecycle report** (`config/examples.json`, written by `lifecycle --out`). It is shown only when
  the report's cluster is the site's cluster and every link is https; otherwise the page says the examples are not
  recorded yet. The committed file is empty until the program runs on devnet.
- Paths A and E (the shop answers, the arbiter decides) are shown on `/contoh` only; the live demo keeps to the two
  scenes where the money moves without anyone's approval.
