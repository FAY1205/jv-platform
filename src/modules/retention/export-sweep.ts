import { and, eq, isNotNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as schema from "@/db/schema";
import { tenantIdWhere } from "@/lib/scope";
import { removeExport } from "@/modules/export/storage";
import { logError } from "@/lib/observability";

// ─────────────────────────────────────────────────────────────────────────────
// C-40 / WP-RET-4 backstop: delete the rendered export .xlsx (Storage) for VOIDED uploads whose
// storage_path is still set. voidUpload deletes the blob immediately (best-effort) and nulls
// storage_path on success; this sweep is the safety net for a delete that FAILED (a transient
// Storage outage) or a pre-fix legacy voided upload. The rendered deliverable carries every lead's
// seller PII, so leaving it is the same LGL-02/DM-09 exposure the DB redaction closes.
// Tenant-scoped (PRN-08); idempotent + self-limiting (nulling storage_path drops the row from the
// next run's candidate set). Best-effort per blob so one failure never stops the rest.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

/** Max exports removed per tenant per run — bounded like the other operational sweeps. */
export const EXPORT_SWEEP_BATCH = 500;

export async function sweepVoidedExports(
  db: DB,
  admin: SupabaseClient,
  tenantId: string,
  limit = EXPORT_SWEEP_BATCH,
): Promise<{ exportsRemoved: number }> {
  const rows = await db
    .select({ id: schema.uploads.id, storagePath: schema.uploads.storagePath })
    .from(schema.uploads)
    .where(
      and(
        tenantIdWhere(schema.uploads, tenantId),
        eq(schema.uploads.status, "voided"),
        isNotNull(schema.uploads.storagePath),
      ),
    )
    .limit(limit);

  let exportsRemoved = 0;
  for (const row of rows) {
    if (!row.storagePath) continue;
    try {
      await removeExport(admin, row.storagePath);
      // Null the path only AFTER a successful remove, so a failed delete stays a candidate next run
      // (never leaves an orphaned blob with no DB pointer for the sweep to find).
      await db.update(schema.uploads).set({ storagePath: null }).where(eq(schema.uploads.id, row.id));
      exportsRemoved += 1;
    } catch (e) {
      logError("export_sweep_remove_failed", { uploadId: row.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { exportsRemoved };
}
