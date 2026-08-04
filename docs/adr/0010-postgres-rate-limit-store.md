# ADR-0010: Postgres-based auth rate-limit / lockout store

- **Status:** Accepted
- **Date:** 2026-07-08
- **Phase / WP:** Phase 2 / WP-024a

## Context

AUT-03 requires sliding-window rate limits on the auth endpoints and AUT-04 a
progressive lockout, both keyed on IP + identifier. Stack §13 leaves the store open:
"rate-limit store (Upstash Redis free tier **or Postgres-based at this volume**)".
The pure decision logic (`rate-limit.ts`, `throttle.ts`, `lockout.ts`) is store-agnostic.

## Decision

Use **Postgres** (the existing Drizzle client) as the rate-limit / lockout store — a
new `auth_attempts` table logging each attempt (identifier, ip, kind, success, ts).
The store supplies a timestamp snapshot to the pure `evaluateThrottle`; no counters
or TTL machinery needed. The table is **not tenant-scoped** (auth runs before the
tenant is known) and is RLS **deny-by-default** (server-managed via the service role).

- No new dependency, no external service, no extra secret — at V1 volume (one admin
  + a few partners, weekly) a couple of indexed reads per login is negligible.
- Indexed on `(identifier, kind, created_at)` and `(ip, kind, created_at)`.

## Consequences

- If auth volume ever grows (many tenants, public surface), swap the store for Upstash
  Redis behind the same snapshot interface — the pure decision code is unchanged.
- `auth_attempts` grows unbounded without pruning; a retention sweep (Phase 3, ACT/retention)
  should delete rows older than the largest window. Not urgent at this volume.
  **Updated by WP-SU-8 (2026-07-29):** that largest window is now **24h**
  (`ALREADY_REGISTERED_CAP`, the per-recipient cap on the "already registered" notice mail),
  not the 1h `LOCKOUT_WINDOW_MS` that was true when this ADR was written. Whoever builds the
  sweep must key the cutoff off the 24h figure — read it from the constants in
  `src/lib/auth/throttle.ts`, do not restate it (restating a rule in two places has drifted
  in this repo before). Still not urgent: `signup_notice` rows are capped at 3 per recipient
  per 24h and are only written when the address already exists.
  **BUILT by WP-SU-11 (2026-07-30)** — `src/modules/retention/auth-attempts.ts`, run as a pass of
  the daily `/api/cron/retention-sweep`. It deletes rows older than
  `max(LOCKOUT_WINDOW_MS, ALREADY_REGISTERED_CAP.windowMs)` **+ 30 days**, both read from the live
  constants exactly as this ADR instructed. The margin, not the max, is the property that makes
  the sweep unable to race a live window: a future WP can widen any window up to a month without
  touching the sweep, and the unit test's `>= ALREADY_REGISTERED_CAP.windowMs` assertion is the
  tripwire if one ever exceeds it. Delete-only, so no migration — the 0004 deny-by-default RLS
  policy already covers a service-role delete. Failure is best-effort and surfaces as
  `cron_auth_attempts_sweep_failed` (ADR-0032), not as a failed check-in.
- Chosen over Upstash to avoid new infra/deps per "boring code / no new deps without an ADR".
