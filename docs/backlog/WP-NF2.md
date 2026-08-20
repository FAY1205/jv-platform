# WP-NF2 — Notifications v2

Owner-decided scope (Slice 8 row "NF2 kickoff decisions 2026-08-19"): four new configurable
notification types · /notifications full page for BOTH roles · per-user prefs + partner portal
surface · per-type + global email unsubscribe. Q8 standing deferral: the assistant / C-62 is
NOT touched. NF3 rollups and C-75 fan-out volume redesign are OUT.

Requirement IDs: **NTF-10 … NTF-17** (extends spec §NTF-01..05). Mockup-light: page layout is
described in §NTF-12/§NTF-15 below; no separate mockup gate.

---

## 0. Verified reality (due-diligence 2026-08-19 — code wins)

- Prefs today are **tenant-level**: one `settings` row (`notification_prefs` key), role buckets
  `admin|partner`, resolved by `resolvePref`/`loadNotificationPrefs`
  ([src/modules/notify/prefs.ts](../../src/modules/notify/prefs.ts)). There is NO per-user layer.
- Emit sites: `enqueueRunDigests` / `notifyStatusChange` / `notifyLeadAssigned` /
  `notifyLeadsBulkAssigned` ([outbox.ts](../../src/modules/notify/outbox.ts)),
  `remindDueTasks` ([task-reminders.ts](../../src/modules/notify/task-reminders.ts)).
- `notifications.type` is plain `text` (schema.ts:646) — **no enum migration** for new types.
- Feed API `GET /api/notifications` returns a fixed 30 rows, no pagination; `[id]/read` +
  `read-all` exist and are `ownerWhere`-scoped.
- Bell (`src/components/NotificationBell.tsx`) is mounted in AppShell:239 and
  PortalShell:160/:173; no "View all" link exists.
- Imports are SYNCHRONOUS in the request (`runUpload`); `upload_status` enum has NO `failed`
  value. Failure modes: `missing_required` 422, `unrecognized` result (both pre-row, ING-08
  detection), and the route's `process_failed` 500 catch. "Completed" = `runUpload` success
  (inside `withDbIdempotency` — replay-safe).
- Partner invite/ToS acceptance: `POST /api/auth/tos/accept` promotes partner
  `invited → active` (route currently does NOT observe whether the promotion happened —
  needs `.returning()`).
- Task assignment: `resolveAssignee` inside `addLeadTask`/`editLeadTask`
  ([tasks.ts](../../src/modules/tasks/tasks.ts):317/440/483) — server-resolved id (PRN-08a shape).
- Partner note: `addLeadNote` via `POST /api/leads/[ref]/notes`; `author_role = streamOf(scope)`.
- Email shell: single footer in `renderEmailDocument`
  ([email-template.ts](../../src/modules/notify/email-template.ts):84-85); all builders compose it.
- `env.APP_URL` is the canonical absolute origin (used by release cron / reminders).
- There is NO general-purpose app HMAC secret in `lib/env.ts` → unsubscribe tokens must be
  DB-stored (split-token), not HMAC-derived.
- Admin tenant matrix UI: `(admin)/settings/notifications/page.tsx`, API
  `/api/settings/notifications` gated `settings.manage`.
- Drizzle journal max `when` = **1787136871489** (0056). Migration 0057 must exceed it.

## 1. NTF-10 — Per-subject preference overlay (migration 0057)

**Table `notification_pref_overrides`** — one row per subject (a user, or a partner ORG for
org-addressed digest emails):

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| tenant_id | uuid not null FK tenants | |
| user_id | uuid null FK users | subject = a seat (admin-stream or partner) |
| partner_id | uuid null FK partners | subject = a partner org (gates `partners.email` sends) |
| value | jsonb not null default '{}' | see shape below |
| token_id | text not null | public half of the unsubscribe token, unique |
| token_secret | text not null | random 32-byte base64url; compared via `timingSafeEqual` (see NTF-13 accepted-risk note) |
| created_at / updated_at | timestamptz | house pattern |

Constraints/indexes: `CHECK (num_nonnulls(user_id, partner_id) = 1)`; unique partial
`(tenant_id, user_id) WHERE user_id IS NOT NULL`; unique partial `(tenant_id, partner_id)
WHERE partner_id IS NOT NULL`; unique `(token_id)`; FK-cover index on `tenant_id`.
RLS: enable + **deny-by-default, server-managed** (the `email_outbox` 0008 pattern — no
policies). Same PR: migration + RLS + indexes (no seed data applies; state that in the PR body).
Journal `when` > 1787136871489.

**`value` jsonb shape** (Zod-validated, all keys optional):
```
{ events?: { [eventKey]: { email?: boolean, inApp?: boolean } }, allEmailsOff?: boolean }
```

**Resolution (pure, unit-tested):**
`resolveEffectiveChannel(tenantPrefs, overlayValue, role, event)` =
tenant `resolvePref` → apply `overlay.events[event]` field-wise → then
`email &&= !overlay.allEmailsOff`. `allEmailsOff` NEVER touches in-app. Partner-ORG overlay
rows apply ONLY the email leg (org rows have no in-app surface).

**Gating retrofit:** every per-user email/in-app emit resolves through the recipient's overlay
(batch loader `loadOverridesFor(db, tenantId, userIds) → Map`); org-addressed emails
(`partner_digest`, partner `hot_leads` to `partners.email`) resolve through the partner-org
overlay. Emails to env `adminAllowlist` extras that resolve to no user keep tenant-level
behavior and get NO unsubscribe link (owner-configured ops addresses — deferred note).

## 2. NTF-11 — Four new types (all configurable rows; email defaults OFF)

Add to `NOTIFICATION_EVENTS` + `DEFAULT_NOTIFICATION_PREFS` + Zod schema + `NotificationPrefs`
type (the tenant matrix UI picks them up automatically). All four default
`{ email: false, inApp: true }` (the `assigned_lead` precedent; flipping any default is an
owner one-liner). Add icons to `NotificationTypeIcon` for each new `type` string.

| key | bucket(s) | label | emit site | recipients | payload rules |
|---|---|---|---|---|---|
| `task_assigned` | admin + partner | "A task is assigned to you" | after `addLeadTask` / `editLeadTask` commits, when the (server-resolved) assignee ≠ actor and ≠ previous assignee | the assignee seat only | title "You were assigned a task on lead {ref}"; body = generic sentence — **NEVER the task title** (it can carry seller PII, SEC-05; the C-13 lesson); deepLink = role-appropriate lead URL (admin `/leads?open={ref}`, partner `/portal/leads/{ref}`); `leadRef` set. Pref bucket = `streamPrefRole(assignee.role)`. |
| `partner_note` | admin | "A partner adds a note to a lead" | `addLeadNote` (or its route) when `streamOf(scope) === "partner"` — PRN-13-safe DIRECTION ONLY (partner → admins); never the reverse | all ACTIVE admin-TIER seats (the `notifyStatusChange` F-8 precedent) | title "New partner note on lead {ref}"; body generic — **the note body NEVER appears in title, body, email, or log** (PRN-13/C-13); deepLink `/leads?open={ref}`; `leadRef` set. |
| `import_result` | admin | "An import completes or fails" | success: inside `runUpload`'s idempotency block (replay-safe). Failure: uploads route on `missing_required`, `unrecognized`, and the `process_failed` catch (best-effort, swallow errors) | success → all ACTIVE admin-tier seats EXCEPT the acting admin (their signal is `run_summary` — no double bell); failure → all ACTIVE admin-tier seats INCLUDING the actor (durable record of what is a transient toast today, ING-08 loud-failure pairing) | success title "Import {uploadRef} processed"; failure title "Import failed: {filename}" + the failure class; filename is operator data, not seller PII — allowed. deepLink: success `/imports/{ref}`, failure `/upload`. No `leadRef`. Repeated failed attempts each notify (loud by design — noted for owner). |
| `partner_activated` | admin | "A partner accepts their invite" | `tos/accept` — add `.returning()` to the promotion UPDATE; emit ONLY when a row actually transitioned `invited → active` (once, ever) | all ACTIVE admin-tier seats | title "{partner name} ({refId}) accepted their invite" (PRN-14 name+ref pairing); deepLink to the partner profile/list. No `leadRef`. |

All emit sites: best-effort (swallow + `logError`, ids only), server-resolved recipient ids —
never from request bodies (PRN-08a). Email legs (when a user turns them on) email `users.email`
seats, composed with `renderEmailDocument` + NTF-14 footer, enqueued via the outbox.

## 3. NTF-12 — /notifications full page, BOTH roles (FEP-03)

**API:** extend `GET /api/notifications` with optional `?cursor=<base64(createdAt|id)>&limit=`
(max 50, default 30). Response gains `nextCursor: string | null`. Keyset pagination on
`(created_at DESC, id DESC)` under `ownerWhere` (the 0055 index already serves it; add `id`
as the tie-break leg in ORDER BY — C-97 discipline). Bell keeps calling it bare (unchanged
shape, additive field).

**Pages:** `(admin)/notifications/page.tsx` → shared client `src/components/NotificationsPage.tsx`
← also mounted at `portal/notifications/page.tsx` (PortalShell). Layout (mockup-light):
- PageContainer + header: title "Notifications", unread count line, "Mark all read" button
  (reuses the bell's optimistic mutation shape), and a **"Preferences"** section anchor/toggle
  (NTF-15).
- Feed: day-grouped (`groupByDay` reuse), each row = `NotificationTypeIcon` + title + body +
  `<time>` + unread dot (PRN-14: dot shape, never tint alone); row click = deep link + optimistic
  mark-read; rows without deepLink mark read in place. States: loading skeletons, honest
  error (`QueryErrorState`), empty ("You're all caught up.").
- Footer: "Load more" button driven by `nextCursor` (`useInfiniteQuery`); disabled/loading states.
- Bell: add a persistent footer row "View all notifications" — href via new
  `viewAllHref` prop (`/notifications` from AppShell, `/portal/notifications` from PortalShell).

## 4. NTF-13 — Tokenized unsubscribe (Tier A-adjacent surface)

**Token** = `{token_id}.{token_secret}` (both random: 16B / 32B base64url, minted lazily by
`ensureSubjectToken` get-or-create on first email enqueue for a subject). Link:
`{APP_URL}/unsubscribe?token=…&event=<key|all>`.

**Endpoint:** public page `src/app/unsubscribe/page.tsx` (no session — email clients):
GET renders a confirm card (APP_NAME identity block, DSN-12; no auto-apply — mail scanners
prefetch GETs) with one button; button POSTs `/api/unsubscribe` `{token, event}` (Zod;
tokenized ⇒ CSRF-exempt by design — document why).
- Verify: parse `token_id`.`secret`; SELECT by `token_id`; compare secret via
  `crypto.timingSafeEqual` (AUT-09). Row missing → compare against a constant dummy of equal
  length anyway (uniform timing), then return the SAME generic success envelope/copy as the
  valid path (AUT-05 posture: the response NEVER reveals whether a token/subject/address
  exists, and never echoes an email).
- Apply (idempotent): `event=all` → `value.allEmailsOff = true`; `event=<key>` →
  `value.events[key].email = false` (key validated against the catalog; unknown key → same
  generic success, no write). USER subject rows gate that seat's emails; PARTNER subject rows
  gate that org's `partners.email` sends. In-app is never touched.
- Accepted risk (state in PR body for audit-security): `token_secret` is stored plaintext so
  links remain mintable per-email; the capability is strictly email-reduction, comparison is
  still constant-time, and a DB-read adversary already holds the addresses themselves.
  No new env var (no suitable app secret exists; HMAC-off-service-role couples to key rotation).

## 5. NTF-14 — Per-recipient footer links in EVERY notification email

`renderEmailDocument` gains optional `unsubscribe?: { typeUrl: string; typeLabel: string;
allUrl: string }` → footer renders
"Unsubscribe from {typeLabel} · Stop all notification emails" links (13px, text3, escaped,
https-only via `safeHref`). Transactional/auth email is NOT touched (NTF-05 clause stands).

Retrofit every notification-email emit to pass per-recipient URLs (base `env.APP_URL`):
`enqueueRunDigests` (partner digest + partner hot → partner-ORG token; admin run-summary +
admin hot → per-user token where the address resolves to a tenant user, else no link),
`notifyStatusChange` (loop per admin user, not per deduped address, so each footer is that
user's token), `notifyLeadAssigned` / `notifyLeadsBulkAssigned` (seat token), `remindDueTasks`
(recipient token), and all NTF-11 email legs. Every retrofit site ALSO applies the NTF-10
overlay gate before enqueueing.

## 6. NTF-15 — Self-serve prefs, both roles

**API `GET/PUT /api/me/notification-prefs`** — any authenticated role, NO capability gate
(own row only): GET returns the caller's role-bucket event catalog + effective channels
(tenant default ⊕ overlay) + `allEmailsOff` + which fields are overridden; PUT accepts the
overlay `value` shape (Zod), upserts the caller's OWN overlay row (`ownerWhere` semantics —
tenant + userId from scope, never from the body). ToS gate consistent with sibling
authenticated routes.

**UI:** a "Preferences" card on the NTF-12 page (BOTH roles — this is the partner-facing
portal surface, and it gives member/viewer seats a surface without touching the
`settings.manage`-gated hub): per-event Email/In-app checkboxes (the settings-matrix visual
language: Checkbox primitive, header row, save button with loading state) + a "Pause all
notification emails" master switch bound to `allEmailsOff`. Copy notes email defaults are
off for new types. The admin tenant-defaults matrix page is UNCHANGED apart from the four new
rows appearing from the catalog + a one-line hint that users can override per-seat.

## 7. NTF-16 — Payload hygiene (binding)

- PRN-13: note bodies never leave the stream wall — not in titles, bodies, emails, or logs.
- SEC-05: no seller PII in any notification payload or log (task titles are PII-bearing —
  generic sentences only, as today's task_due rows already discovered via C-13/redaction).
- New notification rows about a single lead set `leadRef` (C-13 void/purge redaction).
- PRN-14: partner identity is always name + refId, never color alone.

## 8. NTF-17 — Tests (requirement-ID-named)

- Overlay resolution matrix (pure): tenant default × overlay × kill switch, both roles.
- TST-01c recipient-set legs for EVERY new/changed emit: cross-tenant, cross-stream,
  deactivated-seat, admin-tier-only (member/viewer excluded from ops types), self-assign
  no-op, previous-assignee-unchanged no-op, invited→active fires exactly once (re-accept
  no-op), partner-note direction (admin note emits NOTHING).
- Unsubscribe: valid/invalid/malformed token uniform envelope; timing-safe compare wiring
  (mock `timingSafeEqual` call-shape or dummy-compare branch test); idempotent re-apply;
  unknown event key; partner-org vs user subject routing; in-app untouched.
- Feed pagination: cursor walks the full set without gaps/dupes across a created_at tie
  (id tie-break pinned); `ownerWhere` isolation on the paginated path.
- Footer: every notification-email builder passes unsubscribe links; auth email does not.
- Email gating: overlay email-off suppresses enqueue but in-app row still created (and
  vice versa); `allEmailsOff` suppresses every kind incl. digests via partner-org row.
- Bell regression: existing bell suite green unmodified.

## 9. PR plan

| PR | Content | Reviews |
|---|---|---|
| **A — foundation** (branch `claude/nf2-prefs-unsubscribe`) | migration 0057 + overlay module in prefs.ts (or `prefs-overrides.ts`) + token mint/verify + `/api/unsubscribe` + `/unsubscribe` page + `/api/me/notification-prefs` + email-template footer param + retrofit of existing emit sites (outbox.ts, task-reminders.ts) to overlay gating + footers | pr-reviewer + audit-security (token surface) + audit-tenancy (overlay loads/feed) + audit-data (migration) |
| **B — new types** (after A merges; `claude/nf2-new-types`) | catalog rows + 4 emit sites (tasks.ts, notes path, uploads route/run-upload.ts, tos/accept) + icons + tests | pr-reviewer + audit-tenancy (new emit recipient sets) |
| **C — pages** (after A merges, parallel with B; `claude/nf2-pages`) | feed cursor pagination + NotificationsPage component + both role pages + bell View-all + Preferences card UI | pr-reviewer (+ audit-tenancy on the feed diff) |

Full integration suite before merging A and B (notify/outbox/scope touched). Windows:
`vitest --maxWorkers=4`. `sql\`now()\`` never `new Date()` in SQL defaults. After every
merge: `gh run list --branch main` (C-98 habit — PR CI skips e2e).

## 10. Deferred for owner (safe reversible defaults applied)

1. Email legs of all four new types default OFF (flip = one line each).
2. `import_result` success skips the acting admin (run_summary covers them); failures notify
   everyone incl. actor, and repeated failed attempts each notify (loud per ING-08).
3. Env `adminAllowlist` extra addresses get no unsubscribe link + tenant-level gating only.
4. Ops types (import_result, partner_note, partner_activated) go to admin-TIER only
   (the Phase C F-8 default) — say if member seats should see partner notes.
5. Unsubscribe tokens stored server-side (split, plaintext secret half) — no new env var;
   swap to HMAC + env secret later if you prefer (invalidates old links).
6. My-preferences surface lives ON the /notifications page (both roles) rather than a new
   settings tab — relocatable.
7. `allEmailsOff` pauses notification email only; transactional auth email always sends
   (NTF-05 clause) — displayed in the UI copy.

---

## 11. NF2b amendment (owner decision 2026-08-20)

**THERE IS NO WORKSPACE-LEVEL NOTIFICATION CONTROL. Every user controls their own
notifications, scoped to their role's catalog.**

Verified before building: prod holds NO `settings` row for key `notification_prefs` (zero rows,
all tenants), so removing the tenant layer changed **zero live behaviour**. No migration, and no
deletion of stored rows — the key simply stops being read (stated in a comment where
`DEFAULT_NOTIFICATION_PREFS` lives).

**Resolution is now two layers, everywhere:**

```
DEFAULT_NOTIFICATION_PREFS  ⊕  the subject's own overlay   (then email &&= !allEmailsOff)
```

| Was | Is |
|---|---|
| tenant `settings.notification_prefs` ⊕ subject overlay | code defaults ⊕ subject overlay |
| `loadNotificationPrefs` / `saveNotificationPrefs` / `mergeNotificationPrefs` / `NotificationPrefsSchema` / `NOTIFICATION_PREFS_KEY` | **removed** (no consumers left — dead code, not stranded) |
| `resolvePref(prefs, role, event)` | `resolvePref(role, event)` |
| `resolveEffectiveChannel(prefs, overlay, role, event)` | `resolveEffectiveChannel(overlay, role, event)` |
| `resolveOrgEmail(prefs, overlay, event)`, `describeSubjectPrefs(prefs, overlay, role)` | one fewer argument each |
| `EnqueueRunDigestsInput.prefs` | **removed** — the fan-out resolves per recipient |
| `GET/PUT /api/settings/notifications` (`settings.manage`) | **retired**; `/api/me/notification-prefs` is the only prefs endpoint |
| Settings → Notifications = the workspace matrix | Settings → Notifications = **the personal page** (the same card the portal renders) |
| /notifications Preferences card on both streams | admin stream: a **link** to Settings → Notifications; portal: the inline card (a partner cannot enter admin Settings) |

`NOTIFICATION_EVENTS`, `DEFAULT_NOTIFICATION_PREFS`, `streamPrefRole` and the whole
`pref-overrides` module are unchanged in purpose — the catalog and the defaults are what the
`/api/me` endpoint and the preferences card render off.

**Consequences worth stating plainly:**

1. **Flipping a default is now a global act.** `DEFAULT_NOTIFICATION_PREFS` moves every seat in
   every tenant that has not pinned that leg. Still one line per leg, still the only lever.
2. **Org-addressed partner email** (`partner_digest`, partner hot alerts → `partners.email`) is
   governed by the shipped default ⊕ the **partner-ORG** overlay, and the only writer of that
   org row is the tokenized unsubscribe link in the mail itself (the org is not a seat and has
   no `/api/me`). Deliberate: whoever reads that shared mailbox holds the off switch, and no
   admin can silently mute a partner's copy of leads they were routed. Turning it back ON is a
   support action today, not a UI — **candidate**. Documented at the emit site in `outbox.ts`.
3. **The task-reminder asymmetry is dissolved** (closes deferred item 8). The NTF-09
   tenant-level early-out read the workspace row and returned before the due select, which made
   that row the one ceiling a user overlay could not widen. It is gone with the row. Cost: a
   tenant whose every seat has muted `task_due` pays an indexed, `limit`ed due select per tick
   instead of one settings read; the overlay + token loads are still one query each per tick.
4. **Reachability**: no gating change was needed for Settings → Notifications. The Settings hub
   sits in the `(admin)` route group, which gates on the PRN-13 **stream** (partners are
   redirected to their portal), not on tier — member and viewer seats already reached
   `/settings/*`, and the hub's nav only hides items carrying a `requires` capability, which the
   Notifications item never had. The only thing that had excluded members was the retired
   route's own `settings.manage` gate.
5. **C-108 closed as a deliberate exemption**: `GET /api/notifications` carries no ToS gate. The
   LGL-01 acceptance boundary is page-level, and the feed carries lead refs + status words +
   filenames + fixed sentences, never seller PII (NTF-16). Recorded in the route header, along
   with the condition that would kill the exemption (a feed that ever carries lead CONTENT).
6. **Unsubscribe page** gained a quiet footer link, "Manage all notification preferences" →
   `/notifications`. Signed out, the proxy redirects to `/login?next=/notifications` and
   `safeNextPath` returns the reader there, so the destination survives. **Known gap
   (candidate)**: the proxy picks the login SCREEN by path prefix, so a signed-out PARTNER lands
   on the admin password screen rather than the portal OTP one, and a signed-in partner is
   bounced by the `(admin)` layout to `/portal/dashboard` (their bell's "View all" reaches the
   portal page from there). Their in-mail control — the confirm button itself — is unaffected.

**Tests**: assertions that pinned "tenant prefs gate X" now pin "defaults ⊕ overlay gate X", set
on the RECIPIENT seat — which is the sharper test, since it also proves the emit resolved the
person it addressed rather than one tenant-wide switch. The retired workspace Zod schema's drift
guard moved onto `PrefOverrideValueSchema`, the remaining place a half-added event would fail to
persist. The retired "fully-muted tenant early-outs" case is replaced by its opposite: one seat
muting `task_due` while another, in the same tick, is still nudged.

### Review round (pr-reviewer + audit-tenancy on PR #155)

No isolation regressions — every recipient set verified byte-identical to main. Applied:

- **Migration 0058** (audit-tenancy F-1) — `DELETE FROM settings WHERE key = 'notification_prefs'`.
  Prod verified **zero rows** (twice: kickoff and review), so it deletes nothing there and clears
  dev/test strays only. The argument is not cleanup but intent: an orphaned row that used to be a
  delivery control invites re-wiring. Hand-authored SQL-only (no snapshot — the 0056 precedent,
  README table updated); journal `when` = **1787241196243**, above 0057's 1787154796243 (the
  timestamp trap). Guard test `tests/unit/notification-prefs-retirement.test.ts`: a src-wide scan
  failing the build if source CODE names the key or resurrects the deleted symbols.
- **Tenant pin on `resolveAdminEmails`** (F-2) — takes the `ScopeContext` and reads the seat
  through `tenantWhere(users, scope)` AND `eq(users.id, scope.userId)`. An id is not a scope, and
  the service role means no RLS backstop (ADR-0013).
- **ADR-0053** (F-3) — the decision, its consequences, and what would reopen it. `SPEC.md` SET-03
  and NTF-05 amended to say per-USER with no workspace control.
- **Settings-nav test** (F-4) — the member/viewer reachability of `/settings/notifications` is
  load-bearing and was unpinned: a test now asserts the item renders with every capability denied
  (and that Team correctly does not), so adding `requires:` to it fails.
- **Sweep-cost leg** (F-6) — the deleted early-out test was the only assertion bounding a tick's
  cost. Its replacement counts SQL on the wire (postgres.js `debug`) across a K=2 and a K=6 tick
  and asserts the overlay + token loads stay at exactly 2 and the seat lookup at 1 — the NTF-14
  N+1, pinned at last.
- **Stale comment** in `pref-overrides.ts` (pr-reviewer F-2) — it cited the deleted
  `NotificationPrefsSchema` as precedent; rewritten to stand on its own, with a tombstone line.
- **C-117** minted (the env ops mailbox now has no off switch at all); **C-116** annotated with
  audit-tenancy F-5's confirmation and its suggested `/preferences` stream-router fix.
