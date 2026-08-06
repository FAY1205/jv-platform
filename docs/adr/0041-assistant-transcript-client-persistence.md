# ADR-0041 — The AI assistant transcript persists client-side only

**Status:** Accepted (2026-08-07)
**Phase / WP:** Phase 4 (AI assistant) / recorded under WP-GOV-1
**Related:** AIA-04 (`ai_feedback` / `ai_memory` seam), SEC-05, AUT-16, ADR-0036 (BYO provider keys)

## Context

The admin AI assistant (`AssistantWidget`, mounted admin-only in `(admin)/layout.tsx`) holds a
running chat transcript. A conversation transcript is exactly the kind of data that tends to drift
into a server table "for convenience", where it would accumulate seller/partner PII the user typed
or that appears in grounded answers — a SEC-05 hazard and a retention liability. The decision to
keep it **out** of the database was made in code but never recorded; a server-side `ai_memory`
table also exists in the schema, which invites the assumption that transcripts are stored there.
This ADR records what actually ships.

## Decision

Persist the assistant transcript **client-side only, in per-tab `sessionStorage`**; write nothing
about conversation content to the server.

- `assistant-session.ts` mirrors state to `sessionStorage` under `jv.assistant.open` (panel open
  flag) and `jv.assistant.messages` (the transcript). The transcript is the AI-SDK `UIMessage`
  array, JSON-serialized, **capped to the last 40 messages** (`MAX_PERSISTED`).
- Semantics are deliberately "saved for this session": React state survives client-side
  navigation natively; the `sessionStorage` mirror adds survival across a hard refresh; the tab
  closing clears it. "New chat" empties the transcript.
- **Sign-out clears it** (`use-sign-out.ts`, AUT-16), so a next login in the same browser tab can't
  inherit the prior user's chat content.
- The chat route (`/api/ai/chat`) touches the DB only for gating + token metering (`ai_usage`,
  which by design stores "counts + cost only — NEVER message content", SEC-05). No transcript is
  written server-side.
- The `ai_memory` table **exists but is intentionally unused** in V1 — no reader, no writer. It is
  the reserved seam for the deferred learned-preferences loop (AIA-04); it is **not** transcript
  storage. See [[jv-leads-next-session-queue]] R-89 (owner: leave the learning loop OFF for now).

*Alternatives considered:* (a) **server-side transcript table** — rejected: it would retain
conversation PII the app otherwise never stores, adding a SEC-05 surface and a retention job for no
V1 benefit (chat is ephemeral, single-user-per-tab). (b) **`localStorage`** — rejected: it would
outlive the session and leak the transcript to the next visitor in a shared browser; `sessionStorage`
+ sign-out clear matches the "this session only" intent.

## Consequences

- No conversation content ever reaches Postgres; there is nothing to redact, retain, or export for
  the transcript, and no cross-user leakage as long as sign-out clears it (covered by AUT-16).
- Transcripts do not survive a tab close or move between devices — acceptable and intended for a
  workspace assistant, not a support-ticket history.
- Reopening this (server-side history, cross-device continuity, or the `ai_memory`
  learned-preferences loop) is a new WP that must bring its own PII-retention + residency design;
  the `ai_memory` seam is already in place for it.
- AIA-06 is unrelated (it is BYO credentials + metering, ADR-0036); this decision traces to AIA-04.
