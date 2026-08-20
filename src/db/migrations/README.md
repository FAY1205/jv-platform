# Drizzle snapshot ledger — intentional SQL-only gaps

`drizzle-kit generate` writes one `NNNN_snapshot.json` per migration it generates. Some of our
migrations are **hand-authored SQL** that `generate` cannot produce — RLS policies, `GRANT`/`REVOKE`,
index *renames*, and `CREATE INDEX CONCURRENTLY` (drizzle models none of these; `schema.ts` declares
no `pgPolicy`/grant objects). Those migrations therefore have **no snapshot file**, and the snapshot
chain deliberately bridges over them. This is intentional (ADR-0048 / DM-13), **not** drift — do not
"fix" it by regenerating.

Missing snapshots (all hand-authored SQL-only migrations):

| Migration | Kind | Bridged by |
|-----------|------|-----------|
| `0036_lead_notes_author_idx` | index add (idempotent `CREATE INDEX IF NOT EXISTS`) | `0038.prevId = 0035.id` |
| `0037_status_history_author_rls` | RLS policy | ″ |
| `0044_rls_parity` | RLS policy | `0048.prevId = 0043.id` |
| `0045_revoke_lead_dml_grants` | `REVOKE` | ″ |
| `0046_default_privileges_least_privilege` | `ALTER DEFAULT PRIVILEGES` + `REVOKE` | ″ |
| `0047_task_note_hold_in_rls` | RLS policy | ″ |
| `0054_phase_c_roles_policies` | RLS policy + backfill + CHECK/FK (non-structural; the structural half is the GENERATED, snapshotted 0053) | ″ |
| `0056_search_trgm` | `CREATE EXTENSION` + GIN `gin_trgm_ops` index adds (drizzle models neither an extension nor an operator class; `schema.ts` declares no trgm index) | `0057.prevId = 0055.id` |
| `0058_retire_notification_prefs_setting` | **DML only** — a key-scoped `DELETE` from `settings` (WP-NF2b; drizzle models no data statement, and no column changed) | the next generated migration's `prevId = 0057.id` |

## Why it's safe

- `drizzle-kit migrate` applies migrations from `_journal.json` + the `.sql` files, **not** from
  snapshots — so a missing snapshot never affects applying migrations.
- `drizzle-kit generate` diffs `schema.ts` against the **latest** snapshot (currently 0053, which
  reflects `schema.ts`), so the intermediate gaps are inert for future generation. The one structural
  change in the set — 0036's `lead_notes_author_user_idx` — is present in `schema.ts` and every
  snapshot from 0038 on.
- `drizzle-kit check` validates the `prevId` chain and reports the bridged DAG as coherent
  ("Everything's fine"). Run it after any hand-authored migration.

The live database (`pg_indexes` / `pg_policies`), not this ledger, is the source of truth for
anything applied out-of-band (see `src/db/manual/` for parked out-of-transaction SQL).
