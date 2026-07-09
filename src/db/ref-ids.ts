import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable, tenant-scoped, immutable reference IDs (DM-07, v2 / ADR-0019):
//   partners  JV-###          leads  LD-YY-#####        imports  IM-YY-###
// The year is rendered two-digit and imports carry the IM- prefix. Allocation is
// transactional via the ref_counters table (monotonic per tenant+entity+year; the
// "upload" entity key is unchanged — only the rendered format moved). Formatting is
// pure and unit-tested.
// ─────────────────────────────────────────────────────────────────────────────

export type RefEntity = "partner" | "lead" | "upload";

/** Two-digit year, e.g. 2026 → "26". */
function yy(year: number): string {
  return String(year % 100).padStart(2, "0");
}

export function formatPartnerRef(n: number): string {
  return `JV-${String(n).padStart(3, "0")}`;
}

export function formatLeadRef(year: number, n: number): string {
  return `LD-${yy(year)}-${String(n).padStart(5, "0")}`;
}

export function formatImportRef(year: number, n: number): string {
  return `IM-${yy(year)}-${String(n).padStart(3, "0")}`;
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
      return formatImportRef(year, n);
  }
}
