# WP-NF1: Notifications correctness batch (D1–D8)
Spec: NTF-01..05 (§6.14), TSK-08, SEC-05/07, PRN-08/13/14 · Phase: post-C · Tier: **A-review**
(notify/outbox = full ceremony incl. audit-tenancy). Merge tiers: **D1 = Tier A (migration) →
built + reviewed + CI-green then PARKED UNMERGED pending owner greenlight. D2–D8 = Tier B.**

Verified against code 2026-08-19 (file:line cited per item). Two PRs:
- **PR-NF1-code** (D2–D8 + tests) — merges on green.
- **PR-NF1-index** (D1 only: schema.ts + migration 0055 + journal) — parked.

## Definition of done

### D1 — bell-read index (Tier A, parked PR)
- [ ] `notifications (tenant_id, user_id, created_at DESC)` — serves `listNotifications`
      (mine + order created_at desc limit 30, notifications.ts:58-64).
- [ ] Partial `(tenant_id, user_id) WHERE read_at IS NULL` — serves `unreadCount` (:76-81).
- [ ] DROP `notifications_user_idx` (schema.ts:660; superseded — every read path filters
      tenant+user). NOTE for review: this was the users.id FK cover; users are never
      hard-deleted (Phase C deactivation model), so acceptable — audit-data to confirm.
- [ ] C-36/0052 tiny-table precedent: plain in-txn CREATE INDEX with the same DM-13
      justification comment (prod table is tiny today; placed before volume). Migration 0055 +
      journal entry (`when` bump trap: must exceed prior entries) + schema.ts in ONE parked PR.

### D2 — deactivated seats receive nothing (NTF-06, mint) — 3 sites + role pin
- [ ] outbox.ts partner-user map (:169-174): add `isNull(users.deactivatedAt)` AND the SCP-01
      `eq(users.role,'partner')` pin (the C-15 class — both lookups today admit any-role rows).
- [ ] `notifyLeadAssigned` (:405-408): same two predicates.
- [ ] `notifyLeadsBulkAssigned` (:434-437): same two predicates.
      (`notifyStatusChange` :349 and task-reminders.ts :145 already filter — the model.)

### D3 — multi-seat partner orgs: ALL active seats, deterministically (NTF-07, mint)
- [ ] The partner-user map becomes partner → user id LIST (today last-write-wins, :174);
      digest + hot-lead in-app notifications (:203, :232) fan out to every active seat.
- [ ] `notifyLeadAssigned`/`notifyLeadsBulkAssigned`: notify every active seat (today
      arbitrary first row). Deterministic order everywhere: `order by created_at asc, id asc`.
- [ ] Partner-facing EMAIL stays org-level (`partners.email`) — unchanged surface.

### D4 — `assigned_lead` gets its own pref entry (NTF-08, mint)
- [ ] prefs.ts: `partner.assigned_lead` in NOTIFICATION_EVENTS (label "A lead is assigned to
      you"), NotificationPrefs, DEFAULT_NOTIFICATION_PREFS = `{ inApp: true, email: false }`,
      schema, merge. Stored partial rows are forward-compatible (merge fills defaults).
- [ ] `notifyLeadAssigned`/`notifyLeadsBulkAssigned` gate on `assigned_lead` (not `new_leads`);
      HONOR the email channel too (enqueue a minimal email per the notifyStatusChange shape)
      so the Settings toggle is truthful — default off preserves today's behavior exactly.
- [ ] Settings UI renders from NOTIFICATION_EVENTS — verify the new row appears with both
      toggles; no default change beyond the entry itself (owner-deferred).

### D5 — muted reminder is NOT burned (NTF-09, mint)
- [ ] task-reminders.ts: after `resolvePref` (:167), when `!channel.inApp && !channel.email`
      SKIP WITHOUT claiming — no reminded_at stamp, no reminder_attempts increment (not an
      orphan; retiring would mis-fire the admin heads-up). Task stays eligible; if prefs
      re-enable later, the one-shot fires then.
- [ ] Tenant-level early-out: if BOTH streams' `task_due` channels are fully off, return
      before the due select (bounds the muted-tenant re-probe cost to one prefs read).
- [ ] UPDATE the pinning test (task-reminders.test.ts:555 "both channels off still stamps
      reminded_at exactly once") to the new contract + a leg proving re-enabled prefs deliver.
      This knowingly inverts the old recorded decision — owner-directed 2026-08-19.

### D6 — notification-visual.ts (D6)
- [ ] Add `task_due` (map to "info" family per NotificationTypeIcon's existing task glyph
      decision) + `task_reminder_orphaned` (neutral/warn — reviewer judgment, PRN-14 text
      accompanies everywhere) to TONE_BY_TYPE; fix the stale header comment (:1-4 omits
      hot_leads + both task types and misattributes the type roster).

### D7 — outbox resilience
- [ ] Jitter: `nextAttemptAt` gets ±25% jitter via an INJECTED random (opts.random, default
      Math.random) — `backoffMs` itself stays pure/tested; new unit legs pin the band.
- [ ] `ResendTransport.send` (resend.ts:22): `AbortSignal.timeout(10_000)` on the fetch so a
      hung send can't eat the 60s cron budget; an abort throws → the normal retry path.
      Status-only error message preserved (SEC-05/ADR-0032).

### D8 — smalls
- [ ] NotificationBell optimistic mark-read + mark-all (onMutate setQueryData readAt/unread,
      rollback on error — the TasksPanel toggle shape), replacing invalidate-only (:58-67).
- [ ] Row timestamps: `<time dateTime={createdAt} title={absolute}>` around the relative
      string (:80).
- [ ] redact-lead-comms.ts: `deepLink: null` joins the notification sentinel `.set` (:51).
- [ ] outbox.ts `emailOn`/`inAppOn` (:113-116): symmetric no-prefs default — both fall back to
      `resolvePref(DEFAULT_NOTIFICATION_PREFS, …)` (email keeps its 028a email-all behavior via
      the defaults, which are email-on for every event this path serves; in-app no longer
      hard-false when prefs are omitted). Prove with a unit leg; enqueueRunDigests call sites
      always pass prefs today — this is the belt-and-braces path only.
- [ ] ADMIN_ALLOWLIST cross-tenant fence: **NOTE ONLY** (Phase D) — comment, do not build.

## Out of scope
Notification retention windows (C-13 shipped); digest rollup-vs-per-task (owner, Slice 8);
read-state pagination; web push.

## Tests
Keep green + extend: task-reminders.test.ts (D5 rewrite + NTF-06 deactivated-recipient leg),
outbox.test.ts (D2/D3 fan-out legs incl. cross-tenant + role-pin, D7 jitter band, D8 default
symmetry), notifications.test.ts (deep_link cleared on redact), assign-notify.test.ts
(NTF-07 all-seats deterministic; NTF-08 pref gate + email leg).
ADD: tests/unit/components/notification-bell.test.tsx (optimistic read, rollback, <time>,
PRN-14 dot+sr-text, error/empty states) and integration legs for the three routes
(GET /api/notifications scope isolation; POST read scoped-idempotent; POST read-all).
D1: index existence/definition assertions live in the PARKED PR only.

## Self-check vs non-negotiables
PRN-08 (every new lookup composes tenantWhere/tenantIdWhere) · PRN-13 (fan-out never crosses
the org wall; role pin added) · PRN-05 (no historical assignment updates — D3 touches delivery
only) · ASN-02 (all-seats is generic, no per-partner exceptions) · SEC-05 (no new PII in
emails/logs; status-only Resend errors) · SEC-07 (transport seam untouched) · DM-08 (n/a) ·
PRN-14 (tone map always paired with text/icon+sr labels).
