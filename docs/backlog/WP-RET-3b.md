# WP-RET-3b — saved_views PII sweep + erasure runbook

Second slice of candidate **C-13**. Tier A (PII), **no migration** (`saved_views` already has
`updated_at`). Follows WP-RET-3a (notifications/outbox half, merged #92).

## Goal

Close the last C-13 PII surface: `saved_views.filters.q`. The leads search box takes seller names,
phone fragments and addresses, and a saved view stores whatever was typed there verbatim, per user,
forever — and the lead purge **cannot** correlate it (the blob holds a search *string*, not a lead
id). Owner decision: **runbook + clear stale `q`** (non-destructive — keep the view).

## Definition of done

- **`sweepSavedViewsPii`** (`operational.ts`): clears just `filters.q` → `""` (the ONLY free-text
  seller-PII field in the blob; partnerId/state/source/statuses/tags are structured, not PII) on
  views untouched > 12 months (`updated_at`). Keeps the view + its structured filters. `updated_at`
  is NOT bumped (staleness reflects real user activity); idempotent (a cleared row has `q=''`).
  Batched via an id subquery; wired into `GET /api/cron/retention-sweep` (`savedViewsCleared` count).
- **Erasure runbook** (`docs/ops/erasure-runbook.md`): the internal ops doc a subject-access /
  deletion request follows — all 7 seller-PII locations (leads, notes, tasks, notifications, outbox,
  `saved_views.filters.q`, the PII-free audit_log), the two purge triggers (void + backstop sweep),
  and the manual steps for the one location that can't be correlated by lead id (`filters.q`).

## Notes / decisions

- **Why clear, not delete:** a saved view is a user artifact (name + structured filters) worth
  keeping; only the aged free-text search needs to go. Deleting the whole view was rejected (owner).
- **12-month window** vs the operational tables' 7/30/90d — a saved view is long-lived config, not
  ephemeral hygiene, so the PII in it ages out slowly. A constant the owner can adjust.
- **Not lead-correlatable:** the sweep is the only *automatic* bound; a targeted subject request must
  search `saved_views.filters->>'q'` for the seller's fragments (runbook step 3).

## Out of scope

- Folding notification/outbox redaction counts into the per-lead `lead.pii_purged` audit row
  (candidate C-37) — would let the runbook's step 4 rely on `audit_log` alone.
- The void-path cross-tenant collision test (candidate C-38, audit-tenancy F-1) — the sweep path
  already proves the shared helper's isolation.

## Tests

- `operational-retention.test.ts` — `sweepSavedViewsPii` clears the stale view's `q`, keeps the view
  itself + a recent view's `q`, and is idempotent (a second pass clears nothing).
