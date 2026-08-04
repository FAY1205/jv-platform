# ADR-0035: Canary-safe `trusted_devices` retention + trust-refresh throttle

- **Status:** Accepted (owner-approved, 2026-07-30)
- **Date:** 2026-07-30
- **Phase / WP:** Phase 2 (Distribution) · WP-SU-14 (discharges the `trusted_devices` pass deferred
  out of WP-SU-13)
- **Relates to:** ADR-0010 (Postgres rate-limit store; derive cutoffs from live constants),
  ADR-0032 (cron monitors + best-effort bolt-on rule). Governed by AUT-10, PRN-08, SEC-05.

## Context

WP-SU-13 pruned three pre-tenant auth token tables. `trusted_devices` was pulled from that WP by its
4-agent review, for two independent reasons:

1. **A naive age-prune narrows AUT-10 reuse detection (audit-security F-1).** `rotate()`
   (`src/lib/auth/refresh.ts:66-79`) checks token REUSE (`rotatedTo != null` → `reuse_revoked` +
   `revokeFamily` + notify) *before* it checks expiry (`now > expiresAt`). And `issue()` sets
   `expiresAt = now + REFRESH_ABSOLUTE_MS` on every rotation — a **sliding per-token** expiry, not an
   absolute-per-family cap (the "30-day absolute cap" comment is a misnomer). So a continuously-used
   family lives indefinitely while its old rotated rows individually pass `expiresAt`. A naive
   `DELETE WHERE expiresAt <= now - margin` would delete those old rotated rows of a **still-active**
   family, turning a leaked-token replay from `reuse_revoked` into `invalid` — the family revoke +
   owner notify silently lost. (No access is granted — the token is expired regardless — but the
   AUT-10 detection/response is narrowed.) This is **not** the false premise "past `expiresAt` ⇒ no
   live read": the reuse check runs first, so an expired rotated row is still a live canary.
2. **The insert path is unthrottled (audit-data F-1).** `/api/auth/trust/refresh` inserts a row per
   successful rotation behind only `assertCsrf`. A script with one valid trust cookie can chain-rotate
   (always presenting the latest token, so reuse never fires) and insert unbounded; a daily retention
   batch cannot keep pace. Retention alone therefore cannot bound growth.

## Decision

**Prune `trusted_devices` family-liveness-aware, and throttle the trust-refresh insert path.**

- **Canary-safe pruning.** `sweepTrustedDevices` (`src/modules/retention/auth-tables.ts`) deletes a
  row only when `expiresAt <= now − 7d` **AND** its family has **no live head**
  (`NOT EXISTS` a row with `rotated_to IS NULL AND revoked_at IS NULL AND expires_at > now` — the
  exact live-head definition in `TrustedDeviceService.listForUser`). An **active** family's rows are never
  pruned, so its reuse canaries survive; a **fully-dead** family's rows past the margin are pruned,
  dropping the abandoned device's IP/label. Anchored on the **stored** `expiresAt` (the 30d
  `REFRESH_ABSOLUTE_MS` is already baked in), so no lifetime literal is restated (ADR-0010). Hung
  best-effort on the daily `retention-sweep` cron behind its own `cron_trusted_devices_sweep_failed`
  code (ADR-0032 bolt-on rule).
- **Throttle.** `TRUST_REFRESH_THROTTLE` (per-family 10/15min + per-IP 30/15min), wired
  sliding-window-only (`reserve → snapshot → rateDecisionWithSelf`), **not** `evaluateThrottle` —
  AUT-04 lockout's escape hatches (owner notify, admin `clearFailures`) don't apply to a non-inbox
  key, and lockout would turn "please sign in again" into a wait that never fixes it (identical
  reasoning to `reset/confirm`). Keyed on **`familyId`** (stable across the rotation chain; a
  per-token key would reset every window and bind nothing), an internal UUID never the token (SEC-05).
- **PRN-08 framing.** `trusted_devices` HAS a `tenant_id`, unlike the three genuinely pre-tenant
  siblings. The age-predicate delete is nonetheless **tenant-agnostic system maintenance** — a
  documented PRN-08 exception, the same class as the cron tenant-list read — because the predicate is
  an age/liveness condition, not a tenant scope. It is NOT described as "pre-tenant."

## Accepted residual

For a family with **no live head** (fully dead), after the 7d margin its rotated canary rows are
pruned, so a leaked old token of *that dead family* replayed later returns `invalid` instead of
`reuse_revoked` — that event's family revoke + notify is lost. **Accepted because:** no access is
granted regardless (every token in the family is rotated/expired/revoked); there is no live session
to protect; the notify would concern a device abandoned ≥ the margin ago; and the competing goal —
dropping the abandoned device's IP/device-label (data-minimisation, the point of the sweep) —
outweighs the marginal notify. The case that matters — an **active** family, where a reuse replay
kills a live session — is fully preserved (proven by test `AUT-10-DEV-CANARY-01`).

**One honest caveat (audit-security F-1, Low/negligible).** `rotate()` demotes the old head and
inserts the successor as two separate autocommitted statements, not one transaction
(`trusted-device.ts:90-104`), so a family has momentarily no live head between those commits. If the
once-daily sweep's `SELECT` interleaves in exactly that micro-window, the `NOT EXISTS` reads the
family as dead and could prune its **≥37-day-old** canaries (recent canaries and the head fail the
age predicate anyway). `batchedDeleteByAge` compounds this slightly: it deletes by a **frozen id
list** captured at SELECT time, so even if the successor INSERT lands and the family becomes live
again before the DELETE fires, the DELETE still removes those ids (the predicate is not re-checked at
delete time). No session is ever granted; at most a replay of one ancient token degrades
`reuse_revoked`→`invalid`. The claim "an active family's rows are never pruned" is thus very slightly
over-stated under concurrency. Root cause is the non-transactional `rotate()` (pre-existing, outside
this WP); the correct fix — wrapping its UPDATE+INSERT in a transaction, which also closes a
pre-existing crash-between-statements hazard — is a candidate for the next trusted-device engine WP.

## Candidate follow-ups (not built here)

- **Transactional `rotate()`** (per the caveat above) — closes the concurrency window and the
  crash-between-UPDATE-and-INSERT hazard. Its complement is collapsing `batchedDeleteByAge`'s
  select-then-delete into one atomic `DELETE ... WHERE id IN (SELECT ... LIMIT n)` so the predicate
  and delete share one snapshot — a change to the shared primitive (affects all sibling sweeps),
  hence deferred rather than done piecemeal here.
- **A leading-indicator signal for the reopen trigger** (audit-devops F-1): emit a success-signal
  `logError` when this pass's `deleted` (or a cheap scan estimate) crosses a threshold, so the
  "volume rose enough to need an index" condition is detectable rather than assumed silent-safe.
- **An unknown-token per-IP load cap** on `/api/auth/trust/refresh` (pr-reviewer F-4) for
  defence-in-depth parity with `VERIFY`/`RESET_CONFIRM` — not a regression (the route had no throttle
  at all before) and low value against a 256-bit token, hence deferred.
- **Hoisting the `familyForToken` lookup into `rotate()`** to save one indexed read per rotation —
  deliberately not done here (simplicity over a negligible saving at a few-per-day cadence).

## Consequences

- **Closes:** audit-security F-1 (reuse-detection narrowing) and audit-data F-1 (unbounded growth).
- **New alert code:** `cron_trusted_devices_sweep_failed` (enumerated in ADR-0032 Consequences; owner
  wires the Sentry rule). A healthy run is silent; the rows-deleted count rides in the 200 response.
- **No migration / no index.** The `expiresAt <= cutoff` predicate plans as a seq-scan + top-N sort
  (no `expiresAt` index); the `NOT EXISTS` correlates on `family_id` and is **expected** to use
  `trusted_devices_family_idx` once the table carries representative volume (a near-empty dev table
  plans it as a seq-scan Join Filter regardless — measured, not yet index-confirmed at scale).
  At this table's volume, once a day, this matches the siblings' accepted cost and ADR-0010's
  Redis-swap revisit trigger. An `expiresAt` index is a candidate follow-up if volume justifies it.
- **Reopens if:** trust-refresh volume rises enough to justify an index, or a `revokedAt`-anchored
  early IP purge for explicitly-revoked-but-not-yet-expired devices is later wanted.
