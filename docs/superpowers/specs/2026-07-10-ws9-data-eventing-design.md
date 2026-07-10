# WS-9 — Data & eventing review (design)

- **Date:** 2026-07-10 · **Branch:** `ws-9/data-eventing` off `phase-2/distribution` (c6c703c)
- **Spec:** REDESIGN-R3 §4 WS-9. **SPEC refs:** SEAM-04, DM-04, PTL-03, PRN-01, PRN-05, PRN-08, PRN-13, PRN-15.
- **Companion ADR:** [ADR-0020 — eventing seam](../../adr/0020-eventing-seam.md).

WS-9 is a review + one ADR + targeted code — **no speculative churn**. Four
deliverables, landed as small TDD slices, each verified with
`tsc --noEmit` + `lint` + `test:unit` + `test:integration` (integration self-skips
locally without `DATABASE_URL`; it runs in CI).

## Deliverable 1 — Eventing seam (ADR-0020)

Decision recorded in the ADR: `audit_log` = admin/security evidence (append-only,
made DB-immutable); `notifications` = per-user inbox (and the home for F-40's
missing partner signal); **`events` is collapsed** (single writer, zero readers,
redundant with `lead_status_history`). See the ADR for full rationale and the
SEAM-04 / PTL-03 amendments.

Two migrations:
- **0014** — `audit_log` immutability trigger (rejects UPDATE/DELETE unless
  `app.audit_log_purge='on'`). Test teardown opts in via a `purgeAuditLog()`
  helper. (F-05 facet.)
- **0015** — `DROP TABLE "events" CASCADE` + remove the Drizzle model/snapshot +
  the `portal/status-update.ts` writer.

Plus F-40 code: best-effort partner `notification` on manual assign / re-route.

## Deliverable 2 — Dead-code removal

Confirmed unreferenced by call-graph grep (nothing but the symbol's own test):

| Removed | Why dead | Note |
|---|---|---|
| `analyticsOverview`, `periodSummary` (`analytics/queries.ts`) | No callers — no `/api/analytics` route exists; superseded by `dashboardData` (WS-2 rolling windows). (F-74) | `dashboardData` stays. |
| `analytics/periods.ts` (+ `analytics-periods.test.ts`) | Only consumers were the two functions above. | |
| `analytics/source-quality.ts` (+ `source-quality.test.ts`) | `campaignQuality`'s only caller was `analyticsOverview`; orphaned by the same WS-2 rewrite. (owner-approved extension of F-74) | |
| `src/lib/auth/cookies.ts` (+ barrel re-export in `auth/index.ts`, + cookie cases in `auth.test.ts`) | Dead, name-divergent (`__Host-jv_session`) session helper never wired to a route; real session cookies live in Supabase SSR / `cookie-options.ts`. (F-29) | |

**Kept** (verified live callers): `analytics/overview.ts` `buildAnalytics` — still
used by `imports/[ref]/page.tsx` (the routing-composition breakdown). Its
`analytics-overview.test.ts` stays.

## Deliverable 3 — `persistRun` + listing-check batching (F-08)

Both run under the per-tenant advisory lock; today they do N round-trips.

- **`run/store.ts` `persistRun`:** replace the per-lead `allocateRef` (one counter
  UPDATE each) with a single `allocateRefBlock(db, tenant, "lead", year, count)`
  (one counter bump by `count`, returns the first number of the reserved block);
  format the N refs locally in input order. Replace the per-lead
  `insert().returning()` loop with a **single multi-row insert**
  (`onConflictDoNothing`, `returning refId`). Determinism preserved: refs are
  assigned to the new-unique leads in the same input order, and the returned
  `leadRefIds` array keeps its position-for-position contract. (Note: `persistRun`
  is the DB adapter, not a `src/modules/pipeline` pure function — PRN-01 governs
  the pipeline, whose golden output is untouched here.)
- **`listing/run-checks.ts`:** replace the per-lead insert + per-lead update loop
  with one multi-row `insert(listingChecks)` and updates **grouped by status**
  (`for (status, ids) → update(...).where(inArray(id, ids))`) — at most K updates
  for K distinct statuses (a small constant) instead of N.

`allocateRefBlock` gets a focused unit assertion for the block math; batching
behavior is covered by the existing `run.test.ts` / `listing.test.ts` integration
suites (extended to assert unchanged ref sequence + flags).

## Deliverable 4 — Schema verdict (answers the owner's DB question)

Every table reviewed for whether it earns its keep. **Conclusion: the only
vestigial table is `events` (dropped in this WS). No other drops beyond
`campaign_recodes` (already removed in WS-1 / migration 0011).**

| Table | Verdict | Role |
|---|---|---|
| `tenants` | keep | tenant root (SEAM-01) |
| `users` | keep | admin + partner user accounts |
| `partners` | keep | JV partner roster |
| `coverage_zips` | keep | ZIP→partner precedence (ASN) |
| `state_rules` | keep | state-fallback assignment |
| `mls_patterns` | keep | MLS filter patterns (PRN-04) |
| `source_profiles` | keep | per-source column maps (SEAM-05) |
| `uploads` | keep | import runs |
| `leads` | keep | canonical lead rows |
| `lead_notes` | keep | admin/partner notes (PRN-13) |
| `lead_status_history` | keep | authoritative status stream (dashboard/activity read it) |
| `listing_checks` | keep | MLS listing-check results (LST-01) |
| `notifications` | keep | per-user inbox (NTF-04); now also F-40 signal |
| **`events`** | **DROP** | write-only, zero readers, redundant with `lead_status_history` |
| `audit_log` | keep + immutable | admin/security evidence (DM-04); trigger added (F-05) |
| `email_outbox` | keep | outbound email queue (NTF-03) |
| `settings` | keep | per-tenant settings |
| `feature_flags` | keep | per-tenant flags (SEAM-09) |
| `ai_memory` | keep | assistant memory (AIA) |
| `ai_feedback` | keep | assistant feedback (AIA) |
| `ref_counters` | keep | ref-ID allocation (DM-07) |
| `idempotency_keys` | keep | request idempotency |
| `auth_attempts` | keep | lockout / enumeration defense (AUT) |
| `reset_tokens` | keep | password reset (AUT) |
| `otp_challenges` | keep | email OTP (AUT) |
| `tos_acceptances` | keep | ToS gate (TR-4; tenant-scoping deferred F-30) |
| `trusted_devices` | keep | device trust (AUT) |

## Slice plan

0. Docs — this design + ADR-0020 (no code). ← this commit
1. Dead-code removal (F-74 + owner-approved `source-quality`; F-29).
2. `persistRun` batching — `allocateRefBlock` + multi-row insert (F-08a).
3. `run-checks.ts` batching — batch insert + grouped update (F-08b).
4. Migration 0014 — `audit_log` immutability trigger + `purgeAuditLog` helper + rejection test (F-05).
5. Migration 0015 — drop `events` + remove writer; F-40 partner notification on assign/re-route.
6. pr-reviewer → fixes → PLAYBOOK §6 self-audit in the final commit → ff-merge → push → cleanup.

## Invariants honored

- **PRN-01** pipeline purity — batching touches only DB adapters, not
  `src/modules/pipeline`; golden output unchanged.
- **PRN-05** no historical mutation — assign/re-route still only writes the
  additive manual overlay; the notification and immutability trigger add nothing
  that rewrites snapshots.
- **PRN-08** scope.ts — every new/edited query keeps its `tenantWhere`/scope
  predicate; the partner-user lookup for F-40 is tenant-scoped.
- **PRN-13** note streams — F-40 reads no notes; the trigger/immutability don't
  touch `lead_notes` filtering.
- **PRN-15** analytics single home — dead-code removal only *shrinks* the
  analytics surface toward `dashboardData`/`partner-performance`.
- **DM (schema change = migration + …)** — 0014/0015 ship with rationale; no new
  seed/RLS/index is applicable (documented in each migration).
