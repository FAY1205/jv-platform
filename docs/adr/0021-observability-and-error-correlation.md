# ADR-0021: Observability seam — single request traceId, Sentry deferred

- **Status:** Accepted (REDESIGN-R3 decision, WS-10); decision 3 (Sentry deferred)
  **amended by ADR-0032** (2026-07-16, Phase A go-live) — decisions 1 and 2 stand
- **Date:** 2026-07-10
- **Phase / WP:** Phase 2 · REDESIGN-R3 WS-10 (Pre-deploy gate)

## Context

Two audit findings sit on the same seam:

- **F-42:** the `traceId` returned in an API error envelope (`http.ts` `newTraceId()`)
  and the id used by `logError()` are generated independently, so a user-reported
  trace can't be correlated with the server log line for the same request.
- **F-07 (facet):** `logError()` is `console.error`-only; real error transport
  (Sentry) is unwired. `SENTRY_DSN` already exists in the typed env, but no SDK
  consumes it.

Sentry is a new dependency **and** needs a DSN/account — an owner reality-gate item
(§WS-10). Owner decision (this session): **defer the Sentry SDK; do the traceId
correlation now.**

## Decision

1. **One traceId per request, threaded through both surfaces.** A request-scoped
   `traceId` is created once at the top of a handler and passed to (a) the success/
   error response envelope and (b) every `logError()` call for that request, so a
   value the user can read off a failure maps 1:1 to the server log line. The
   `{code, message, traceId}` error envelope is unchanged in shape.

2. **`logError` gains an optional `traceId` field**, emitted in the structured log
   line. Its best-effort, never-throw, SEC-05 (no secrets/PII) contract is unchanged.

3. **Sentry stays behind the `logError` seam, deferred.** No `@sentry/nextjs`
   dependency is added in R3. When the owner provisions a DSN, wiring Sentry is a
   single change inside `logError` (and an instrumentation file) — the call sites
   already pass structured, PII-free context + a traceId. `SENTRY_DSN` remains the
   activation switch; until it is set, `logError` is console-only (today's behavior).

## Consequences

- `newTraceId()` stays the id source; handlers that both log and respond derive one
  id and reuse it. No per-call-site id divergence.
- No new dependency, no new env var (SENTRY_DSN already typed). Sentry activation is
  a follow-up gated on the owner DSN — recorded here so the seam is intentional, not
  forgotten.
- Full request-tracing (OpenTelemetry, per-request context propagation across async
  boundaries) is out of R3 scope; the traceId is passed explicitly, not via async
  local storage. Boring and sufficient for correlating a user report to a log.
