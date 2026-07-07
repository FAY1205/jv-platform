import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable, tenant-scoped, immutable reference IDs (DM-07):
//   partners  JV-###          leads  LD-YYYY-#####       uploads  UP-YYYY-###
// Allocation is transactional via the ref_counters table (monotonic per
// tenant+entity+year). Formatting is pure and unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

export type RefEntity = "partner" | "lead" | "upload";

export function formatPartnerRef(n: number): string {
  return `JV-${String(n).padStart(3, "0")}`;
}

export function formatLeadRef(year: number, n: number): string {
  return `LD-${year}-${String(n).padStart(5, "0")}`;
}

export function formatUploadRef(year: number, n: number): string {
  return `UP-${year}-${String(n).padStart(3, "0")}`;
}

/**
 * Atomically allocate the next counter for (tenant, entity, year) and return the
 * formatted reference ID. Uses an upsert-increment so concurrent callers never
 * collide. `year` is passed in (never derived from a clock inside pure code).
 */
export async function allocateRef(
  db: PostgresJsDatabase<Record<string, unknown>>,
  tenantId: string,
  entity: RefEntity,
  year: number,
): Promise<string> {
  const rows = await db.execute<{ counter: number }>(sql`
    INSERT INTO ref_counters (tenant_id, entity, year, counter)
    VALUES (${tenantId}, ${entity}, ${year}, 1)
    ON CONFLICT (tenant_id, entity, year)
    DO UPDATE SET counter = ref_counters.counter + 1
    RETURNING counter
  `);
  const n = Number((rows as unknown as { counter: number }[])[0].counter);
  switch (entity) {
    case "partner":
      return formatPartnerRef(n);
    case "lead":
      return formatLeadRef(year, n);
    case "upload":
      return formatUploadRef(year, n);
  }
}
