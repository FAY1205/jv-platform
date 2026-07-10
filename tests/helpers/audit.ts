import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

/**
 * Delete audit_log rows in test teardown despite the append-only trigger
 * (migration 0014). Opts into the session-scoped `app.audit_log_purge` escape
 * hatch inside a single transaction — exactly the deliberate path a future
 * retention sweep would use. `set local` scopes the flag to this transaction, so
 * it never leaks to other work on the connection. App code must never call this.
 */
export async function purgeAuditLog(db: PostgresJsDatabase<typeof schema>, where: SQL): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local app.audit_log_purge = 'on'`);
    await tx.delete(schema.auditLog).where(where);
  });
}
