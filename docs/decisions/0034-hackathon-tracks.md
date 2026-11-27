# 0034. Hackathon tracks: only what the live code uses

Date: 2026-11-27 · Status: accepted

## Context

The submission form lists the main tracks and a set of partner tracks. Each track toggled in the form asks for a
description of the integration and a link to the code, and partner tracks ask for an integration the project actually
uses. The form also has a separate "Local hub" field; local tracks are attached to hubs, not to the track toggles.

What the live site uses today, measured on 2026-11-27: `/api/health` on kekal.sasateguh.com reports `features: []`
(no partner service switched on). The site stores its records in SQLite. The video narration is a stock synthetic
voice run locally (ADR 0019), not a partner API.

## Decision

Tracks entered, each with a description and a code link in the submission kit:

| Track | Why it applies | Code |
|---|---|---|
| Best App Overall on Solana | The whole app: the Anchor program on devnet, the web app, the fee relayer and the keeper | [`programs/kekal/src`](../../programs/kekal/src) |
| Best DeFi App on Solana | A stablecoin reserve held by a program-owned vault and paid out by deadline rules | [`payout.rs`](../../programs/kekal/src/instructions/payout.rs) |

Partner tracks not entered, because no live code uses them:

| Track | State in this repository |
|---|---|
| Supabase | A Postgres store is written and tested (`DATA_BACKEND=supabase`) but not switched on at the live site |
| ElevenLabs | Not used; no voice API is called by the app or the video build |
| Firecrawl, Pollar, Byte, Seeker (Solana Mobile), Agentic | Not used |

Local hub: Malaysia (Kuala Lumpur), where the project is built. It is a form field, not an integration, so nothing in
the code depends on it.

A partner track is added only when its integration runs on the live site, appears in `/api/health` `features`, and is
described in the README under Integrations with where it lives in the code.

## Consequences

- The README "Integrations: none" line, `/api/health` and the submission form say the same thing.
- Switching on the Postgres store later would make the Supabase track a candidate; that needs the store running on the
  live site first, not only in tests.
