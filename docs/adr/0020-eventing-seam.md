# ADR-0020: Eventing seam — audit_log vs events vs notifications

- **Status:** Accepted (REDESIGN-R3 decision, WS-9)
- **Date:** 2026-07-10
- **Phase / WP:** Phase 2 · REDESIGN-R3 WS-9 (Data & eventing review)

## Context

The schema carries three append-ish "something happened" tables whose roles had
drifted and overlapped. WS-9 must state one rule for each and decide whether the
`events` table earns its keep (audit finding F-40 / SEAM-04) or is collapsed.

Observed reality in the code (not the aspiration in the spec):

| Table | Writers today | Readers today |
|---|---|---|
| `audit_log` | ~10 admin mutation paths (partner.created, upload.voided, note added, coverage/rules edits, session revoked, invite, lead.manually_assigned, lead.edited, …) | Activity page (`activity/queries.ts`) |
| `notifications` | `createNotification` — partner digests, admin run-summary, status-change (all via `notify/outbox.ts`) | NotificationBell + Settings → Notifications (`notify/notifications.ts`) |
| `events` | **exactly one:** `portal/status-update.ts` writes `type:"status.changed"` | **none in production** (only an isolation test) |

Two facts decide the `events` question:

1. **`events` has no reader.** SPEC SEAM-04 says "digests and the notification
   center consume it now; webhooks later." They do **not** — both consume
   `notifications`/`email_outbox`. The "consume it now" clause was never wired;
   `events` is a write-only table.
2. **Its single write is redundant.** The same portal status change already
   appends the authoritative `lead_status_history` row (which the dashboard and
   Activity feed read). The `events` row duplicates that with an extra `byRole`
   field nobody reads.

Separately, F-40 flags a genuine gap: admin manual-assign / re-route
(`leads/commands.ts`) records only `audit_log` — the **receiving partner gets no
signal**. And F-05 flags that `audit_log`, the compliance evidence trail, has no
DB-level immutability.

## Decision

**One role per table, and collapse `events`.**

1. **`audit_log` — admin & security evidence, append-only (DM-04).** "Who did
   what, when," with actor / before / after / traceId. Admin-scoped; drives the
   Activity page. Made **immutable at the database** (migration 0014): a
   `BEFORE UPDATE OR DELETE` trigger raises unless the session sets
   `app.audit_log_purge = 'on'` (an explicit, self-documenting escape hatch used
   only by test teardown and a future retention sweep — never by app code).

2. **`notifications` — per-user inbox (NTF-04).** "Tell *this* user." Scoped to
   tenant + recipient user id. Unchanged in shape. **This is where F-40's real
   gap is closed:** manual assign / re-route now writes a best-effort
   notification to the receiving partner's user (ADR-0014 side-effect rules), so
   the partner learns they were given a lead — the signal that was missing.

3. **`events` — collapsed.** Dropped in migration 0015; the lone
   `portal/status-update.ts` writer is removed (the status change remains fully
   recorded in `lead_status_history`). Rationale: a write-only table with zero
   readers and redundant content is precisely the dead weight WS-9 is chartered
   to remove ("prefer boring code"). Adding lifecycle writers instead would mean
   writing rows nobody reads until a future webhooks/member-feed phase — that is
   speculative build-ahead the R3 spec forbids ("review + ADR + targeted code,
   no speculative churn"). When a real consumer arrives (per-partner webhooks,
   SEAM-04's "later"), a purpose-built stream can be reintroduced cleanly against
   that consumer's contract.

Nothing is lost for the documented future-proofing: the **member-role** seam is
`scope.ts`'s effective-owner rule (§5), not `events`.

## Consequences

- Migration **0014** adds the `audit_log` immutability trigger (function +
  BEFORE UPDATE and BEFORE DELETE triggers). No new columns/indexes/RLS policies
  (existing `audit_tenant_created_idx` and RLS stand); the trigger is the whole
  change. A `purgeAuditLog()` test helper wraps deletes in a tx that sets
  `app.audit_log_purge`; the eleven integration suites that clean up `audit_log`
  (six direct deletes + five cleanup-loop arrays) switch to it.
- Migration **0015** drops `events` (`DROP TABLE "events" CASCADE`) and the
  Drizzle `events` model + snapshot are removed. `portal/status-update.ts` drops
  the `events` insert; `portal-scope.test.ts` drops its `events` isolation
  assertion and cleanup.
- F-40 notification: `manuallyAssignLead` and `editLead` (action `set`) resolve
  the target partner's user (`users.partner_id`) and best-effort
  `createNotification(type:"assigned_lead", deepLink → portal lead)`. Skipped
  silently when the partner has no onboarded user (matches the outbox pattern).
- **SPEC amendments to reconcile** (flagged, not edited inside this ADR, per the
  WS-6 CVG-02 precedent):
  - **SEAM-04** (SPEC §4): the `events`-table mechanism is retired; its stated
    consumers (digests, notification center) are served by `notifications` +
    `email_outbox`; webhooks remain a future seam to be built against a real
    consumer.
  - **PTL-03** (SPEC §… "every change → `lead_status_history` + event"): drop
    the "+ event" clause; a portal status change writes `lead_status_history`
    (and the admin notification) only.

## Alternatives considered

- **Keep `events`, add `lead.assigned` / `status.changed` writers (SEAM-04 as
  written).** Rejected: still zero readers in R3 → a table written but never
  consumed, the same anti-pattern this WS removes. Reintroduce with its consumer.
- **Fold everything into `audit_log`.** Rejected: conflates admin evidence
  (immutable, admin-scoped) with a per-user inbox (mutable `read_at`,
  user-scoped) — different lifecycles and access rules.
