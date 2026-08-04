# ADR-0014: Best-effort side effects around the transactional run core

- **Status:** Draft (canonicalizes an existing implicit decision — owner to confirm)
- **Date:** 2026-07-09
- **Phase / WP:** process (pattern emerged across WP-020/028/033)

## Context

An upload run has a transactional core — `processRun` + `persistRun` (one transaction,
advisory-lock first, ING-06) — and a tail of side effects: export rendering/storage
(EXP-05), digest enqueue + outbox drain (NTF-01..03), listing checks (LST), in-app
notifications (NTF-04). A failure in any side effect must never fail or roll back a
correctly processed run: the owner's export is still reachable (regenerate-on-download
fallback), and email is retried via the outbox.

This pattern is implemented consistently (`src/modules/run/run-upload.ts`: each side
effect in try/catch → `logError`) but was never recorded as a rule.

## Decision

- The run pipeline's durability boundary is the `persistRun` transaction. Everything
  after it is **best-effort**: wrapped individually in try/catch, failures logged via
  `logError` with context, never propagated to the API response.
- Retry semantics by channel: **email** retries via the outbox (backoff, max 5);
  **export storage** falls back to regenerate-on-download; **listing checks** are
  informational and simply absent until re-run. No side effect blocks another.
- Every new post-persist side effect joins this pattern — inside its own guard, after
  the transaction, ordered so cheaper/more-important effects run first.

Alternative considered: transactional outbox for ALL side effects (single pattern,
stronger guarantees) — overkill at V1 volume; email already has the outbox where
retries matter most.

## Consequences

- Users never lose a processed run to an email/storage hiccup; determinism and
  history stay intact (PRN-05).
- **The cost is silence:** best-effort failures are only visible in `logError`, which
  is console-only today. This ADR makes ACT-03 (Sentry) + ACT-05 (drain cron +
  heartbeat) load-bearing before real weekly operation — tracked as open items in
  `docs/ENGINEERING_STANDARDS.md` §4/§10.
- Audit hooks: `pr-reviewer` flags any bare catch on this path; `audit-devops` tracks
  the observability gap until wired.
