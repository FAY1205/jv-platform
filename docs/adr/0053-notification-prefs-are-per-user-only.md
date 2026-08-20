# ADR-0053: Notification preferences are per-user only — no workspace layer

- **Status:** Accepted
- **Date:** 2026-08-20
- **Phase / WP:** WP-NF2b (Notification-preferences simplification) / migration 0058

## Context

Since WP-029, notification delivery resolved through **two stored layers plus the code defaults**:

1. `DEFAULT_NOTIFICATION_PREFS` — shipped defaults, per role bucket, per event.
2. A **workspace** row: one `settings` row keyed `notification_prefs`, holding a full
   role × event × channel matrix, edited at `/settings/notifications` behind `settings.manage`.
3. A **per-subject** overlay (`notification_pref_overrides`, WP-NF2/NTF-10): one row per user
   seat or partner org, applied field-wise, plus an `allEmailsOff` email kill switch.

The middle layer had three problems, and they compounded.

**It answered a question nobody had asked.** The workspace matrix decided delivery *for everyone*
— one admin choosing whether a colleague's phone buzzes. Every other preference in the product is
personal. Nobody used it: verified live against production on 2026-08-20 (twice, at WP kickoff and
again at review), the `settings` table holds **zero** rows for the key, across all tenants. The UI
shipped and was never saved.

**It created a ceiling.** The reminder sweep (`remindDueTasks`) read the workspace row once per
tenant per tick and returned early when `task_due` was muted on both legs for both streams — a
real cost control for a cron that pays per tenant. But it meant a seat who had explicitly opted
*into* task-due email was silently ignored, while every other emit site honoured the same opt-in.
That asymmetry was flagged in code and carried to the owner as WP-NF2 deferred item 8. It was not
a bug in the sweep; it was the two-layer model showing through.

**It made every reader carry a parameter.** `resolvePref`, `resolveEffectiveChannel`,
`resolveOrgEmail`, `describeSubjectPrefs` and `EnqueueRunDigestsInput` all threaded a
`NotificationPrefs` value that was, at every live call site, the result of loading a row that did
not exist — i.e. the defaults.

## Decision

**There is no workspace-level notification control. Every user controls their own notifications,
scoped to their role's catalog.** (Owner decision, 2026-08-20.)

Resolution is exactly two layers, everywhere:

```
DEFAULT_NOTIFICATION_PREFS  ⊕  the subject's own overlay   (then email &&= !allEmailsOff)
```

Concretely:

- The `settings.notification_prefs` layer is removed from every read path. `loadNotificationPrefs`,
  `saveNotificationPrefs`, `mergeNotificationPrefs`, `NotificationPrefsSchema` and
  `NOTIFICATION_PREFS_KEY` are **deleted** rather than left unused, and the signatures above lose
  the parameter rather than being fed `DEFAULT_NOTIFICATION_PREFS` at each call site — a constant
  threaded through a signature reads like a variable and invites someone to thread a different one.
- `GET/PUT /api/settings/notifications` is retired. `/api/me/notification-prefs` is the only
  notification-preferences endpoint, and it is deliberately un-gated: it decides only for its
  caller.
- **Migration 0058** deletes the row (`DELETE FROM settings WHERE key = 'notification_prefs'`). It
  removes nothing in production — the point is that an orphaned row which *used to be a delivery
  control* is a standing invitation to re-wire it. A guard test
  (`tests/unit/notification-prefs-retirement.test.ts`) fails the build if source code names the key
  or resurrects the deleted symbols.
- `/settings/notifications` becomes the **personal** page for admin-stream seats, mounting the same
  `NotificationPreferencesCard` the partner portal renders — one editor, two mounts. No gating
  change was needed: the Settings hub gates on the PRN-13 *stream*, not on tier, so member and
  viewer seats already reached it; the retired route's own `settings.manage` gate was the only
  thing that had excluded them.

## Consequences

- **Flipping a default is now a global code change.** `DEFAULT_NOTIFICATION_PREFS` is the only
  base layer, so changing a leg moves every seat in every tenant that has not pinned that leg in
  its own overlay. This is intended ("one place decides the default; each person decides for
  themselves") and it is still one line per leg — but it is a deploy, not a setting, and it is no
  longer per-tenant. A tenant that genuinely needs different defaults from another tenant would
  reopen this ADR.
- **The task-reminder asymmetry is gone.** With no workspace row there is nothing to early-out on,
  so the sweep resolves every recipient on its own overlay like every other emit. The cost it used
  to avoid is now bounded by the due select's index and `limit` and by the batch overlay/token
  loads (one query each per tick) — pinned by a sweep-cost test so an N+1 reintroduction fails.
- **The partner-ORG address is governed only by its own unsubscribe token.** `partner_digest` and
  partner hot alerts go to `partners.email` — a shared mailbox behind no login. It is now
  defaults ⊕ the partner-org overlay row, and the *only* writer of that row is the tokenized
  unsubscribe link in the mail itself (an org is not a seat; it has no `/api/me`). Deliberate:
  whoever reads that mailbox holds the off switch, and no admin can silently mute a partner's copy
  of leads they were routed. The corollary is that re-subscribing has no UI — candidate **C-115**.
- **The env ops mailbox is governed by nothing.** `ADMIN_ALLOWLIST` addresses belong to no seat, so
  they have no overlay, no unsubscribe footer (§10.3), and — now — no workspace switch either.
  They email unconditionally. That is a real regression in controllability and is carried as
  candidate **C-117** (options: an env off-switch, or dropping the allowlist from
  `resolveAdminEmails` entirely now that `activeAdminSeats` covers real seats). Owner decision.
- **Easier:** one resolution rule to reason about, one endpoint, one editor component, and every
  emit site gates on the person being told rather than on a tenant-wide switch — which is also why
  the tests got sharper (they now name the recipient).
- **What would reopen it:** a tenant-level *policy* requirement rather than a preference — e.g. a
  compliance rule that a workspace must be able to force an event's email off for everyone. That
  is a different thing from a default and should be modelled as a policy that *narrows* the
  resolution, not as a third layer restored in the middle of it.
