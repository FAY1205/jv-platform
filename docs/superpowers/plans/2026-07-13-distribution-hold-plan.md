# Plan — 10-minute distribution hold + only-latest void

Design: `docs/superpowers/specs/2026-07-13-distribution-hold-design.md`. Tier A. One commit (or
split cron/reads if it grows). Build order (each step green before the next):

1. **TDD pure helper** — `tests/unit/hold-window.test.ts` (RED) → `src/modules/run/hold-window.ts`:
   `HOLD_WINDOW_MS` (= `VOID_WINDOW_MS`), `releaseCutoff(now, windowMs?)`, `isHeld(createdAt, now,
   windowMs?)`. Names cite the feature/ING-09.
2. **Migration** — add `uploads.distributed_at timestamptz` (+ partial index for the release scan:
   `WHERE distributed_at IS NULL`) to `src/db/schema.ts`; `drizzle-kit generate` → migration 0020;
   apply to dev.
3. **Void guard** — `src/modules/run/void.ts`: add `isLatestImport` (max non-voided `created_at`
   for the tenant) → `NotLatestImportError` (409 `not_latest_import`); skip the recall notice when
   the run was still held. Route maps the new error.
4. **Gate partner reads** — add `lte(leads.createdAt, releaseCutoff(now))` to every partner-scoped
   read: `listPartnerLeads`, `getPartnerLeadDetail`, `getPartnerExportData`,
   `partnerPerformanceDetail` (raw SQL), `listPartnerActivity`, `updateLeadStatus`, portal notes.
   Admin reads untouched.
5. **Move the push to release** — drop `enqueueRunDigests` from `runUpload`; add a release step to
   the cron: for uploads `processed AND created_at <= releaseCutoff(now) AND distributed_at IS NULL
   AND not voided` → set `distributed_at`, `enqueueRunDigests`, drain. Idempotent + advisory lock.
   Piggyback the existing `/api/cron/drain-outbox` (or a sibling).
6. **Tests (integration, live dev DB)** — held lead invisible to each partner read, visible after
   the window (backdate `created_at`); no digest at import, digest at release (once); void:
   latest+held ok, not-latest → 409, released → 409; admin sees held leads; release skips voided.
7. **Gate** — `pnpm typecheck`; eslint changed; unit serial; integration serial (`--no-file-
   parallelism`); PLAYBOOK §6; pr-reviewer + audit-tenancy + audit-data + audit-api-contract.
8. **Owner walkthrough** (readback: the timing tests) → go before commit AND push.

**Ships-with dependency:** the cron heartbeat (ACT-05, external watchdog) — the release push relies
on it; the go-live checklist item must be done alongside.
