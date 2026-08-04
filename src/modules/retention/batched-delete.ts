import { and, asc, inArray, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

// WP-SU-13: the one place the retention delete loop lives. Mirrors sweepAuthAttempts' shape exactly
// — select the oldest N rows matching an age predicate, then delete them by id — so every sibling
// pass is bounded, idempotent, oldest-first, and transaction-free (a duplicate concurrent run at
// worst re-deletes rows the other already removed, a no-op; there is no append-only side effect to
// double-write). Delete-only: every target table is RLS deny-by-default, so no migration is needed.
//
// WP-SU-18 (CWE-367): the DELETE re-asserts `spec.where`, so a row is removed only if it STILL
// matches the age predicate — closing a SELECT→DELETE TOCTOU. For the append-only siblings the age
// column never moves, so this is a no-op; it matters for notice_claims, whose notified_at is
// rewritten in place by claimLockoutNotice's ON CONFLICT DO UPDATE — a concurrent re-lock that
// refreshes a captured row now spares it from this batch instead of being deleted out from under a
// live claim. Strictly safer for trusted_devices too (a family that regained a live head between
// select and delete keeps its canary).
type DB = PostgresJsDatabase<typeof schema>;

export interface BatchedDeleteSpec {
  /** The table to prune. */
  table: PgTable;
  /** Its primary-key column, used for the delete-by-id set and the returning count. INVARIANT:
   *  every caller keys on a `uuid` (string) PK — the `r.id as string` cast below relies on it.
   *  A tighter `PgColumn<{data:string}>` bound was tried but drizzle's generic requires the full
   *  ColumnBaseConfig; documented here instead (audit-data F-4, WP-SU-13 review). */
  id: PgColumn;
  /** The age column to drain oldest-first — createdAt for token tables, expiresAt for sessions. */
  orderBy: PgColumn;
  /** The age predicate: rows matching this are eligible for deletion. */
  where: SQL;
  /** Hard cap on rows removed per run. */
  limit: number;
}

export async function batchedDeleteByAge(db: DB, spec: BatchedDeleteSpec): Promise<{ deleted: number }> {
  const stale = await db
    .select({ id: spec.id })
    .from(spec.table)
    .where(spec.where)
    .orderBy(asc(spec.orderBy))
    .limit(spec.limit);
  if (stale.length === 0) return { deleted: 0 };

  const ids = stale.map((r) => r.id as string);
  // Re-assert spec.where at delete time (WP-SU-18): only remove rows that STILL match the age
  // predicate, so a row refreshed in place between the select and the delete is spared.
  const removed = await db
    .delete(spec.table)
    .where(and(inArray(spec.id, ids), spec.where))
    .returning({ id: spec.id });
  return { deleted: removed.length };
}
