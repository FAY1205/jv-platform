# WP-TSK-2a — fold the distribution hold into taskWhere/noteWhere + RLS

Promoted from candidate **C-8** (WP-TSK-2 audit-tenancy F-3). Tier A (prod RLS migration + scope guard).

## Goal

Move the distribution-hold predicate (`releasedLeads`) from local compensators in `tasks.ts`
into the scope guard (`taskWhere` / `noteWhere`) AND the matching RLS policy arms, so the app
layer and the Postgres backstop carry the hold in lockstep (SEC-01, the WP-SEC-2 discipline).
WP-TSK-2 could not: its brief forbade touching `lib/scope.ts` and the task migration, so it
compensated with a local `partnerHoldGate` on the two paths that don't resolve a lead first
(`resolveTask`, `listMyTasks`). That guard-blindness is what this WP closes.

Depends on **C-30** (the RLS enforcement oracle now runs in CI) — landed in PR #88 — so the RLS
half is proven by the oracle on every CI run, not just locally.

## Definition of done

- `taskWhere(scope, db, now?)` and `noteWhere(scope, db, now?)` carry `releasedLeads(now)` in the
  partner `ownLeads` subquery. The optional `now` lets the TSK-08 reminder sweep inject its clock
  (via `taskVisibleTo`); request paths default to `new Date()`.
- Migration **0047** adds the hold predicate (`leads.created_at < now() - interval '5 minutes'`,
  mirroring `VOID_WINDOW_MS`) to the partner `ownLeads` subqueries of `lead_tasks_scope` and
  `lead_notes_scope`, in **both USING and WITH CHECK** (WITH CHECK ≥ USING per ADR-0046). Admin
  arms are never hold-gated. Journal `when` bumped above 0046 (migration-timestamp trap).
- `partnerHoldGate` and all four of its call sites are deleted; `taskWhere` now carries the hold.
- `partnerLive` (the write-path lead-resolution gate in `tasks.ts`/`notes.ts`) and `liveLeadGate`
  (the both-roles My Tasks live-lead filter) stay — they cover the INSERT paths that resolve a
  lead before writing, which `taskWhere`/`noteWhere` do not gate.
- The RLS oracle proves enforcement: a partner cannot SELECT or INSERT a task/note on a still-held
  lead via the `authenticated` surface (new RLSB-04 hold case), and still reads its own released
  rows (existing RLP/RLSB, seeds backdated to release the leads a partner must see).

## Out of scope

- The `notifications`/`email_outbox`/`saved_views` retention sweep — that is C-13 / WP-RET-3 (batch 3).
- The `setDone` two-clock bug (`doneAt`/`updatedAt: new Date()` in `tasks.ts` — a site C-25's
  `sql\`now()\`` sweep missed). Surfaced as a pre-existing flake while verifying this WP; recorded
  as a fresh candidate, not fixed here.

## Tests

- `tests/integration/rls-behaviour.test.ts` — new RLSB-04 (C-8) case: held lead → partner read +
  write both denied via the authenticated role; released leads still visible.
- `tests/integration/rls-parity.test.ts`, `tasks-scope.test.ts` — seeds backdated (`RELEASED_AT`)
  so the leads whose children a partner must see are past the hold; existing assertions hold.
- `tests/integration/tasks-api.test.ts` — already carried held-lead cases (unchanged, still green).

## Self-audit

Printed in the session summary per PLAYBOOK §6.
