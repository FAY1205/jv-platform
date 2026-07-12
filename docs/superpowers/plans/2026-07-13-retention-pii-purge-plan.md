# Plan — WP-GL-B retention PII purge

Design: `docs/superpowers/specs/2026-07-13-retention-pii-purge-design.md`. One commit.

1. **TDD pure helper** — write `tests/unit/retention-purge.test.ts` (RED), then
   `src/modules/retention/purge.ts` (GREEN): `RETENTION_GRACE_DAYS/MS`, `retentionCutoff`,
   `isPastRetention`, `redactionPatch`, `REDACTED_RAW_JSON`.
2. **Schema + migration** — add `piiPurgedAt` column + partial index to `leads` in
   `src/db/schema.ts`; `drizzle-kit generate` → migration 0019; apply to dev DB.
3. **Adapter** — `src/modules/retention/sweep.ts`: `sweepTenantPii` (txn: select batch →
   redact UPDATE → per-lead audit insert). Mirror `void.ts` idiom.
4. **Cron route** — `src/app/api/cron/retention-sweep/route.ts` (mirror `drain-outbox`).
5. **vercel.json** — add the daily `/api/cron/retention-sweep` cron.
6. **Integration test** — `tests/integration/retention.test.ts` (self-skip w/o DB); run live.
7. **Gate** — `pnpm test:unit --no-file-parallelism`, integration serial, `pnpm typecheck`,
   eslint changed files; PLAYBOOK §6 self-audit; pr-reviewer + audit-data + audit-tenancy.
8. **Walkthrough** — present + the 3 flagged decisions; get go before commit AND push.
