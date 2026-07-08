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
- Chosen over Upstash to avoid new infra/deps per "boring code / no new deps without an ADR".
