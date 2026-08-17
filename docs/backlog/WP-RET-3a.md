# WP-RET-3a — notifications retention + void/purge redaction of comms

Promoted from candidate **C-13** (audit-tenancy F-2), first of two slices. Tier A (migration + PII).
Slice **3b** (saved_views `q`-clear sweep + the erasure runbook doc) follows separately.

## Goal

Close the notification/outbox half of the C-13 PII gap. `run/void.ts` and `retention/sweep.ts`
redacted a soft-deleted lead's `leads`/`lead_notes.body`/`lead_tasks.title`, but **notifications**
were touched by neither *and* had no retention at all — and a `task_due` notification's title
embeds the task's free text (seller PII) verbatim (`Task due: <task title>`), so it sat in the bell
indefinitely and survived a void. Owner decision: **keep the informative title** (visibility) and
handle the PII by redacting on void + an age sweep, rather than genericizing the title.

## Definition of done

- **Migration 0049**: `notifications` gains a nullable `lead_ref` (refId string, mirrors
  `email_outbox.meta.leadRef`) + a partial index `(tenant_id, lead_ref) WHERE lead_ref is not null`,
  so the purge paths can find a lead's notifications. `createNotification` accepts + stamps it;
  the three lead-scoped sites stamp it (`task_due`, `status_change`, single `assigned_lead`);
  aggregate notifications (hot_leads/run_summary/bulk-assign) leave it null.
- **Void + backstop redact comms**: a new shared helper `redact-lead-comms.ts` redacts a lead's
  notifications (title → sentinel, body → null) by `lead_ref` and its `email_outbox` rows
  (subject/body → sentinel, html → null) by `meta.leadRef`. Called by BOTH `voidUpload` (immediate)
  and `sweepTenantPii` (backstop) so they never diverge; idempotent; tenant-scoped (PRN-08).
  `SweepResult` + the cron response gain `notificationsRedacted`/`outboxRedacted` (the C-7 pattern).
- **Notifications age sweep**: `sweepNotifications` (90-day `createdAt` window, mirrors ai_feedback)
  wired into the retention cron as the general bound on un-voided leads' accumulated PII.

## Out of scope (→ WP-RET-3b)

- `saved_views.filters.q` seller-PII sink — the `updated_at`-keyed `q`-clear sweep.
- The erasure runbook doc listing every seller-PII location (leads, notes, tasks, notifications,
  outbox, saved_views, redacted audit_log) — created once in 3b covering both slices.

## Notes / decisions

- **`lead_ref` is a soft correlation marker, not a FK** — matches `email_outbox.meta.leadRef`; a
  redacted lead keeps its `ref_id` (DM-07), so the correlation survives the purge.
- **Which notifications carry seller PII:** only `task_due` (the task title). `status_change` /
  `assigned_lead` titles carry just the refId (kept post-redaction), but they're stamped + redacted
  too as a safe superset — a voided lead's stale notifications are cleaned regardless.
- **Reachability:** a void happens within the 5-min hold (partners never emailed), so on void the
  redaction mostly catches admin-side notifications/emails. The age sweep is the general bound; the
  backstop sweep covers any future soft-delete path.

## Tests

- `retention.test.ts` — the backstop sweep redacts the purged lead's notification + outbox row,
  leaves the LIVE lead's intact (`notificationsRedacted`/`outboxRedacted` counts asserted).
- `void.test.ts` — voiding redacts the lead's notification + outbox in the same transaction.
- `operational-retention.test.ts` — `sweepNotifications` deletes aged rows, keeps recent.
