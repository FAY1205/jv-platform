import { asc, inArray, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

// WP-SU-13: the one place the retention delete loop lives. Mirrors sweepAuthAttempts' shape exactly
// — select the oldest N rows matching an age predicate, then delete them by id — so every sibling
// pass is bounded, idempotent, oldest-first, and transaction-free (a duplicate concurrent run at
// worst re-deletes rows the other already removed, a no-op; there is no append-only side effect to
// double-write). Delete-only: every target table is RLS deny-by-default, so no migration is needed.
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
  const removed = await db.delete(spec.table).where(inArray(spec.id, ids)).returning({ id: spec.id });
  return { deleted: removed.length };
}
