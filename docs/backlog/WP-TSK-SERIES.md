# WP-TSK series: Lead Tasks + Timeline (CRM slice 1)

Spec: TSK-01..10 (catalog below — fold into docs/SPEC.md as §6.22 when WP-TSK-1 lands)
Phase: CRM-1 · Depends: nothing (pure additive layer) · Mockup: approved 2026-08-15
(artifact 3783fa02) · ADR: 0044 (visibility model, Accepted 2026-08-15)

## Why

The CRM-evolution program (memory: jv-leads-crm-evolution): the app routes leads but has
no work-tracking layer — the single biggest gap vs. a professional CRM. This series adds
tasks, a unified per-lead timeline, a My Tasks view, and a due-date nudge. Scoring, MLS,
routing, and assignment history are untouched. Owner-reduced scope: tasks only — no
call/meeting/lunch activity types, no participants, no files, no recurrence.

## Requirement catalog (TSK-01..10)

- **TSK-01 — Task shape.** A task belongs to exactly one lead. Fields: `title`
  (1..200 chars, required), `due_on` (date, optional), `assigned_to_user_id`
  (optional), `done_at` (nullable timestamptz — null = open). Tasks are rows in a new
  `lead_tasks` table; nothing is stored on the lead row.
- **TSK-02 — Visibility (two streams, ADR-0044).** Tasks mirror the lead-notes model
  (PRN-13): `author_role ∈ {admin, partner}`; admin tasks and partner tasks are
  mutually invisible. A partner sees only tasks authored by their own org on leads they
  currently own (`partnerOwnsLead` + own-org-author predicate, exactly `noteWhere`'s
  shape). Tasks do NOT follow the lead on re-route — the prior org's tasks are never
  shown to a new owner.
- **TSK-03 — Assignee.** Nullable FK → `users`. Defaults to the creator. Assignee must
  belong to the same stream (admin task → admin user; partner task → a user of that
  partner org). UI shows a picker only when the actor's stream has >1 eligible user;
  otherwise silently self-assigns. (Forward-compatible with multi-seat partner orgs —
  no schema change needed later.)
- **TSK-04 — Complete / reopen.** Completing sets `done_at`; reopening nulls it. Both
  idempotent (repeating the current state is a no-op, no duplicate events). Completion
  and creation each surface as timeline entries.
- **TSK-05 — Delete.** Author-only, open-tasks-only, writes an `audit_log` entry
  (`task.deleted`). A completed task is permanent (a timeline fact, like a status row).
- **TSK-06 — Timeline.** The lead detail's activity feed merges: system events
  (imported / routed / assigned), status changes, notes, task-created, task-completed —
  newest first. Scope-filtered per stream: a partner's timeline shows only their own
  org's notes/tasks and follows R-22 status-author semantics. Filter chips
  (All / Tasks / Notes / Status) are client-side.
- **TSK-07 — My Tasks.** A standalone view (admin `/tasks`, portal `/portal/tasks`)
  listing the actor's visible open tasks grouped **Overdue / Today / Upcoming**
  (+ a Done toggle), each row linking to its lead. Server-paginated.
- **TSK-08 — Reminder.** When `due_on ≤ today` and the task is open and
  `reminded_at IS NULL`: one in-app notification + one email (per notification prefs,
  new event `task_due` for both roles, defaults on/on), to the assignee (fallback:
  author), then stamp `reminded_at`. Exactly one nudge per task, ever. Email content:
  lead ref + city/state + task title — never seller name/phone/email (SEC-05).
- **TSK-09 — Scoping proof.** Every read/write passes the scope guard (PRN-08) via a
  new `taskWhere()`; Postgres RLS policy carries the identical predicate (SEC-01,
  both halves). TST-01-style isolation tests prove: cross-tenant, cross-partner,
  cross-stream (admin↔partner), and post-re-route invisibility.
- **TSK-10 — Pure date logic.** Overdue/Today/Upcoming grouping and reminder-due
  predicates are pure functions of `(dueOn, today)` with `today` injected — no
  `Date.now()` inside module logic (PRN-01 discipline). `due_on` is a calendar date
  compared in UTC; documented, revisit if tenant timezones ever matter.

## WP breakdown

| WP | Scope | Tier | Model |
| -- | ----- | ---- | ----- |
| WP-TSK-1 | Schema + scope guard + RLS (detailed below) | A | Fable/Opus 4.8 |
| WP-TSK-2 | API routes (lead tasks CRUD, complete/reopen, My Tasks list) | A | Fable/Opus 4.8 |
| WP-TSK-3 | Timeline read-model (extend detail assembly, both roles) | A | Fable/Opus 4.8 |
| WP-TSK-4 | Lead record UI: Tasks panel + Timeline (admin dialog + portal) | B | Sonnet 5 |
| WP-TSK-5 | My Tasks pages + nav (admin sidebar item, portal 5th tab) | B | Sonnet 5 |
| WP-TSK-6 | Reminders: `task_due` pref event + due-sweep in drain-outbox | A | Fable/Opus 4.8 |

Sequence: 1 → 2 → 3+4 (one review batch) → 5 → 6. One WP per session. Audit stage 6:
`audit-tenancy` on TSK-2/3/6 (TSK-1 done); `pr-reviewer` only on TSK-4/5.

### Forward requirements from the WP-TSK-1 tenancy audit (2026-08-15) — bind on later WPs

**WP-TSK-2 (write path) MUST:**
- Derive `author_role` from `scope.role` and `author_user_id` from `scope.userId` —
  never from the client (audit F-1 companion; notes.ts precedent).
- Derive `tenant_id` from a `leadWhere`-scoped lead lookup by refId — never accept a
  raw `lead_id` or `tenant_id` from the request (audit F-3; notes.ts:77-84 pattern).
- Resolve the lead with `partnerLive(scope)` too, so a partner cannot create/list tasks
  on a still-held lead (audit F-7; copy notes.ts:45-49). Test: "TSK-02: a partner cannot
  create a task on a held lead".
- Validate `assigned_to_user_id`: same tenant AND same stream (admin task → in-tenant
  admin; partner task → user of the author's partner org) (audit F-2). Test: "TSK-03:
  a task cannot be assigned outside the author's stream/tenant".
- Delete = `taskWhere` ∩ id ∩ author check (author-only), per TSK-05.
- Join the PII purge paths: add a `REDACTED_TASK_TITLE` sentinel and extend
  `run/void.ts` + `retention/sweep.ts` to redact `lead_tasks.title` exactly as note
  bodies (audit F-5), + a test mirroring the note-redaction case.

**WP-TSK-6 (reminders) MUST:**
- Resolve the reminder recipient THROUGH `taskWhere` for that recipient's scope — never
  a raw `assigned_to_user_id` join; if the recipient cannot see the task, fall back to
  the author and log (audit F-2). Test: "TSK-08: a reminder is never sent to a recipient
  who cannot read the task".

---

# WP-TSK-1: `lead_tasks` schema + scope guard

Spec: TSK-01, TSK-02, TSK-03 (column only), TSK-09 · Tier A · Depends: ADR-0044 approved

## Goal

The `lead_tasks` table, its RLS, and `taskWhere()` in `lib/scope.ts` — the entire
security surface for the series, landed and proven before any API or UI exists.

## Definition of done

- [ ] Migration 0041 (or next free): `lead_tasks` — `id` uuid PK default random,
      `tenant_id` FK→tenants NOT NULL, `lead_id` FK→leads NOT NULL, `author_user_id`
      FK→users NOT NULL, `author_role` authorRoleEnum NOT NULL, `assigned_to_user_id`
      FK→users NULL, `title` text NOT NULL, `due_on` date NULL, `done_at` timestamptz
      NULL, `reminded_at` timestamptz NULL, `created_at`/`updated_at` (house helpers).
- [ ] Indexes: `lead_tasks_lead_idx(lead_id)`, `lead_tasks_tenant_idx(tenant_id)`,
      `lead_tasks_author_user_idx(author_user_id)`,
      `lead_tasks_assignee_idx(assigned_to_user_id)` (FK-covering, db-linter 0001
      precedent), and partial `lead_tasks_open_due_idx(tenant_id, due_on)
      WHERE done_at IS NULL` (serves the reminder sweep + My Tasks grouping).
- [ ] Drizzle journal `when` manually bumped above 1786264900000 (0036/0037 trap).
- [ ] RLS policy `lead_tasks_scope` mirroring the app predicate (admin: tenant +
      author_role='admin'; partner: tenant + author_role='partner' + own-org author +
      lead currently owned & not deleted). Same migration.
- [ ] `taskWhere(scope, db)` in `lib/scope.ts`, structurally parallel to `noteWhere`
      (base tenant + role stream + `ownLeads`/`ownAuthors` subqueries). JSDoc explains
      the re-route rationale, citing ADR-0044.
- [ ] Seed — AMENDED at implement time (pr-review F-1): `db/seed.ts` seeds no leads at
      all (partners + rules only — verified), so there is nothing to attach a task FK to
      there; inventing lead rows would change that file's design. Demo tasks (both
      streams, one overdue, one due-today, one done) move to `scripts/seed-demo-dataset.mjs`
      as a WP-TSK-4 DoD item, where the lead-bearing demo data actually lives.
- [ ] TST-01-style tests (requirement-ID names): "TSK-09: partner A cannot read partner
      B's tasks", "TSK-09: admin tasks invisible to partner and vice versa", "TSK-09:
      re-routed lead hides prior org's tasks from new owner", "TSK-09: RLS blocks a raw
      cross-tenant read" + shape checks for TSK-01.

## Out of scope

API routes, UI, reminders, timeline assembly (WP-TSK-2..6). Any `events`-stream work —
the events table was removed (ADR-0020); automation is a future phase with its own ADR.

## Tests

`tests/integration/tasks-scope.test.ts` — isolation matrix above; runs against the
dev/test Supabase project (pooler :6543, `?sslmode=require`; copy `.env.local` into any
worktree first — the false-green gotcha).

## Gotchas carried in

Migration `when` bump · worktree `.env.local` · cold Vite cache false-red · full
integration suite before merge (shared-analytics lesson).
