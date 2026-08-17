# ADR-0048: SQL-only migrations, concurrent index adds, and the drizzle snapshot gap

- **Status:** Accepted (2026-08-17)
- **Date:** 2026-08-17
- **Phase / WP:** CRM hardening / Slice 1 (C-35 + C-36)

## Context

Migrations are applied by `drizzle-kit migrate`, which runs **each migration file in a single
transaction** and applies the SQL in journal order (`src/db/migrations`, drizzle.config.ts). Two
recurring realities do not fit that model, and both have already been worked around twice by hand:

1. **Some migrations are hand-authored SQL that `drizzle-kit generate` cannot produce.** RLS
   policies, `GRANT`/`REVOKE`, and index *renames* are not modelled by drizzle's schema snapshot
   (`schema.ts` declares no `pgPolicy`/grant objects), so those migrations are written by hand and
   never go through `generate`. Consequently their `meta/NNNN_snapshot.json` files were never
   created: migrations **0036, 0037, 0044, 0045, 0046, 0047** (and the 0048 index-rename) have no
   snapshot, and the snapshot chain jumps `0035 → 0038` and `0043 → 0048` (verified: `0038.prevId`
   = `0035.id`, `0048.prevId` = `0043.id`). This *looks* like ledger drift (C-35).

2. **Adding an index (or a column that rewrites) to a populated prod table cannot run inside the
   migrate transaction.** A plain `CREATE INDEX` takes a write-blocking `ShareLock` for the whole
   build — forbidden post-launch (migrations 0027 / WP-J2). The lock-free form,
   `CREATE INDEX CONCURRENTLY`, **cannot run inside a transaction block**, and drizzle's
   single-file-txn migrate has no non-transactional path. This is exactly why the
   `notifications (tenant_id, lead_ref)` partial index was *dropped* from migration 0049 and left
   for a manual apply (C-36), and why 0036/0037 were reconciled to prod by hand (memory: the
   "migration timestamp trap").

Doing nothing leaves both patterns as tribal knowledge rediscovered per session, and leaves the
snapshot gap looking like an accident an unwary session might "fix" by regenerating — which would
re-chain the coherent DAG for no benefit.

## Decision

Promote the twice-written rule to the spec (**DM-13**, §5) and record the two mechanics here.

1. **Concurrent, out-of-transaction structural changes (DM-13).** Any index or column add on a
   *populated prod* table uses the lock-light form (`CREATE INDEX CONCURRENTLY`, or an
   `ADD COLUMN` with no default rewrite) and is applied **out-of-transaction, manually to prod** —
   the way 0036/0037 were reconciled — never inside a `drizzle-kit migrate` single-file
   transaction. When one change needs both a transactional part and a concurrent index, **split it
   into two files**: the transactional DDL as a normal migration, the `CONCURRENTLY` index as a
   documented manual step. A concurrent index is Tier A (a prod change) → owner greenlight, and is
   verified live via `pg_indexes`, not the drizzle ledger.

2. **SQL-only migrations intentionally have no snapshot.** RLS/`GRANT`/`REVOKE`/index-rename/
   `CONCURRENTLY` migrations are hand-authored, bypass `drizzle-kit generate`, and therefore ship
   **without** a `meta/NNNN_snapshot.json`. The snapshot chain bridges them by design;
   `drizzle-kit check` validates that bridge as coherent (confirmed: "Everything's fine"). This is
   **not** drift and must not be "fixed" by regeneration. Future `drizzle-kit generate` diffs
   against the *latest* snapshot (which reflects `schema.ts`), so the intermediate gaps are inert.

   - *Rejected — regenerate/backfill the six snapshots:* would re-chain a DAG `drizzle-kit check`
     already accepts, churn the existing generated snapshots' `prevId`s, and still could not model
     the RLS/grant changes those migrations actually made. No functional gain, real risk.

3. **Document it at the source.** `src/db/migrations/README.md` records which migrations are
   SQL-only and why they have no snapshot, so the gap reads as intentional (it lives one level above
   `meta/`, which `drizzle-kit` parses as JSON snapshots). Parked out-of-tx SQL lives in
   `src/db/manual/` with a run note.

## Consequences

- **Easier:** the next author of a prod index/column add, or of an RLS/grant migration, inherits
  the rule (DM-13) instead of rediscovering the `ShareLock`/`CONCURRENTLY`/txn constraints. The
  snapshot gap no longer reads as an error.
- **Harder / watch:** the drizzle ledger is no longer a complete structural history — `pg_indexes`
  / `pg_policies` (live introspection) is the source of truth for anything applied out-of-band, not
  `meta/*_snapshot.json`. `drizzle-kit check` remains the guard that the chain is internally
  coherent; run it after any hand-authored migration.
- **Reopens if:** drizzle gains a first-class non-transactional / `CONCURRENTLY` migration path (or
  we adopt a tool that models RLS/grants), at which point these migrations could go through
  `generate` and carry snapshots like any other.
- **Resolved (C-36, migration 0052):** the `notifications (tenant_id, lead_ref) WHERE lead_ref is not
  null` index shipped as a **plain** drizzle migration, not the parked `CONCURRENTLY`-out-of-tx step.
  The DM-13 rule targets *populated* tables; `notifications` is tiny in prod (~6 rows), so a plain
  `CREATE INDEX`'s ShareLock is sub-millisecond — placed now, while small, so it precedes unpredictable
  end-user volume (same rationale as 0051's covering index). The parked
  `src/db/manual/notifications_lead_ref_idx.concurrent.sql` was removed. The CONCURRENTLY-out-of-tx
  path remains the rule for a genuinely large table.
