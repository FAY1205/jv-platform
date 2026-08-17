# Erasure runbook — seller-PII locations & how each is purged

**Internal ops doc** (not the public privacy policy). It answers one question: when a seller
exercises a deletion / subject-access right (LGL-02, CCPA-style), **where is their personal
information, and how is it removed?** Keep it in lockstep with the retention code — every new place
that can hold seller free-text or contact data gets a row here.

Seller PII = name, phone, email, street address, and any free text a human typed about a seller
(notes, task titles, search strings, notification/email bodies). Coarse location (city/state/zip5),
the internal `ref_id`, and decision columns are **kept** (DM-07) — they are not personally
identifying and the audit trail (DM-04) depends on them.

## The two purge triggers

1. **Void (immediate)** — `voidUpload` (`src/modules/run/void.ts`) soft-deletes a run's leads and
   redacts their PII **in the same transaction** (owner decision 2026-07-13: a void is a "wrong
   file" undo, so the PII goes at once). Grace window = 0 (`RETENTION_GRACE_DAYS`).
2. **Backstop sweep (scheduled)** — `sweepTenantPii` (`src/modules/retention/sweep.ts`), run by
   `GET /api/cron/retention-sweep`, redacts any soft-deleted-but-unpurged lead. The operational-table
   sweeps (`src/modules/retention/operational.ts`) run alongside it.

Both purge paths share the same sentinels (`src/modules/retention/purge.ts`) and the same comms
helper (`redact-lead-comms.ts`), so they never diverge.

## PII locations

| # | Location | What | How it's erased | Correlates by |
|---|----------|------|------------------|---------------|
| 1 | `leads` (sellerFirst/Last, phone, phoneNorm, email, address, addressNormalized, reasonForSelling, motivation, timeToSell, notes, rawJson, dedupeKey) | The seller's contact + all seller-provided fields + the raw source row | `redactionPatch()` on void + backstop sweep — columns nulled/sentineled; `pii_purged_at` stamped | lead id |
| 2 | `lead_notes.body` | Free text an admin/partner typed (most likely place a human pasted seller PII) | Sentineled (`REDACTED_NOTE_BODY`) on void + sweep | lead id |
| 3 | `lead_tasks.title` | Free-text task title (e.g. "call Jane at 555-…") | Sentineled (`REDACTED_TASK_TITLE`) on void + sweep | lead id |
| 4 | `notifications.title` / `.body` | A `task_due` notification embeds the task free text (seller PII) | Redacted (`REDACTED_NOTIFICATION_TITLE`) on void + sweep (`redact-lead-comms.ts`); **also** an unconditional 90-day age sweep (`sweepNotifications`) | `notifications.lead_ref` (refId) |
| 5 | `email_outbox.subject` / `.body` / `.html` | A `task_due` / `status_change` email carries the same free text | Redacted on void + sweep (`redact-lead-comms.ts`); **also** a 30-day terminal-row age sweep (`sweepEmailOutbox`) | `meta.leadRef` (refId) |
| 6 | `saved_views.filters.q` | A per-user saved search string — the leads search box takes seller names / phone fragments / addresses | **Cannot** correlate to a lead (it's a search string, not a lead id). Cleared to `""` on views untouched > 12 months (`sweepSavedViewsPii`); the view itself is kept | user id + staleness only |
| 7 | `audit_log` (before/after) | Append-only; deliberately carries **no** seller PII (SEC-05 — the purge audit records counts + booleans only) | N/A — never holds PII by construction | — |

## Handling a subject request over a specific seller

1. Find the seller's lead(s) by `ref_id` or coarse identifiers (an admin scope; PRN-08).
2. If the lead is live, void its import (within the window) or soft-delete it so the backstop sweep
   redacts it — this covers rows 1–5 automatically (leads, notes, tasks, notifications, outbox).
3. Row 6 (`saved_views.filters.q`) is **not** reachable by lead id. Search `saved_views.filters->>'q'`
   across the tenant for the seller's name/phone/address fragments and clear/redact the matching
   `q` fields manually; the 12-month sweep is only the automatic backstop.
4. Confirm via the `lead.pii_purged` audit rows (row 7) and the cron response's per-artifact counts.

## Keep this current

Adding any column/table that can hold seller free-text or contact data **must** add a row here and a
purge path (void + backstop, or an age sweep). Open item: fold notifications/outbox counts into the
per-lead `lead.pii_purged` audit row (candidate C-37) so step 4 needs only `audit_log`.
