# WP-TSK-6a — orphaned-reminder terminal state + sweep wall-clock budget

Promoted from candidate **C-14** (WP-TSK-6 audit-tenancy F-3). Tier A (prod migration). Last item of
the batch-3 compliance/retention block.

## Goal

`remindDueTasks` (TSK-08) deliberately does NOT stamp a task whose recipient can't be resolved
(re-routed / mis-assigned / cross-stream), so an orphan was re-selected and re-probed — two
`taskVisibleTo` queries each — on **every 5-min cron tick, forever**. And the reminder sweep is the
only unbounded duty in the 60s `drain-outbox` cron: a tenant with ≥ the batch limit (200) of due
tasks whose recipients don't resolve makes no progress and can starve the job.

## Definition of done

- **Migration 0050**: `lead_tasks += reminder_attempts integer NOT NULL DEFAULT 0` (constant default →
  no table rewrite, no index, no lock — safe on the live table).
- **Retire orphans**: the sweep's candidate filter adds `reminder_attempts < REMINDER_ATTEMPTS_MAX`
  (=6, ~30 min at 5-min ticks). The no-recipient path increments the counter under the per-tenant
  advisory lock; the tick that reaches MAX **retires** the task (it drops from the candidate set) and
  notifies the tenant's admins **exactly once** (`task_reminder_orphaned`, generic title + lead ref —
  no task-title PII, correlated for C-13 redaction). A re-assignment before MAX still makes it
  deliverable; after MAX it's retired and surfaced instead of re-probed forever.
- **Wall-clock budget**: `remindDueTasks` takes an injected `deadlineMs` (+ `clockMs`, default
  Date.now); the per-task loop stops claiming new tasks once real time passes the deadline. The
  `drain-outbox` cron sets one shared deadline (`runStart + REMINDER_BUDGET_MS`, 30s), so no single
  tenant's backlog can push the job past its 60s maxDuration — the remainder is picked up next tick.
- Cron response gains `tasksRetired`.

## Notes / decisions

- **Attempt counter, not a separate terminal column**: `reminder_attempts >= MAX` IS the terminal
  state (implicit in the sweep filter). One column, no extra flag; the atomic
  `WHERE reminder_attempts < MAX` increment makes retirement single-fire even under concurrent ticks.
- **`remindedAt` still means "delivered"**: an orphan never sets it (it was never nudged). Retirement
  is a distinct state (`reminder_attempts` hit MAX), so the two are not conflated.
- **Injected clock for the budget**: the budget is *real* elapsed time, deliberately separate from the
  TSK-10 run clock (`now`) that drives eligibility/stamping — so a wall-clock deadline can't perturb
  determinism. `clockMs` is injected so tests are deterministic.

## Tests

- `task-reminders.test.ts` (new C-14 block): an orphan increments per tick, retires at MAX with
  exactly one generic admin heads-up (no task title, correct lead ref), and is not re-probed after;
  the wall-clock budget (passed deadline) claims nothing while a normal sweep nudges the same task.
