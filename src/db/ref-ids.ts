import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable, tenant-scoped, immutable reference IDs (DM-07, v2 / ADR-0019):
//   partners  PR-###          leads  LD-YY-#####        imports  IM-YY-###
// The year is rendered two-digit and imports carry the IM- prefix. Allocation is
// transactional via the ref_counters table (monotonic per tenant+entity+year; the
// "upload" entity key is unchanged — only the rendered format moved). Formatting is
// pure and unit-tested.
// Partner prefix JV- → PR- (owner testing note #7, 2026-07-15; migration 0022
// renames existing rows). Historical audit_log entity_refs keep JV- — append-only.
// ─────────────────────────────────────────────────────────────────────────────

export type RefEntity = "partner" | "lead" | "upload";

/** Two-digit year, e.g. 2026 → "26". */
function yy(year: number): string {
  return String(year % 100).padStart(2, "0");
}

export function formatPartnerRef(n: number): string {
  return `PR-${String(n).padStart(3, "0")}`;
}

export function formatLeadRef(year: number, n: number): string {
  return `LD-${yy(year)}-${String(n).padStart(5, "0")}`;
}

export function formatImportRef(year: number, n: number): string {
  return `IM-${yy(year)}-${String(n).padStart(3, "0")}`;
}

/** Render counter `n` for an entity (single formatting home for both allocators). */
function formatRef(entity: RefEntity, year: number, n: number): string {
  switch (entity) {
    case "partner":
      return formatPartnerRef(n);
    case "lead":
      return formatLeadRef(year, n);
    case "upload":
      return formatImportRef(year, n);
  }
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
  const [ref] = await allocateRefBlock(db, tenantId, entity, year, 1);
  return ref;
}

/**
 * Atomically reserve a CONTIGUOUS block of `count` counters for (tenant, entity,
 * year) in ONE upsert (F-08 — replaces N per-row increments under the run's
 * advisory lock) and return the `count` formatted refs in ascending order. The
 * single `counter + count` bump means concurrent callers still never collide; a
 * caller that later burns a number (e.g. an ON CONFLICT skip) just leaves a gap,
 * exactly as the single allocator does. `count = 0` reserves nothing.
 */
export async function allocateRefBlock(
  db: PostgresJsDatabase<Record<string, unknown>>,
  tenantId: string,
  entity: RefEntity,
  year: number,
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];
  const rows = await db.execute<{ counter: number }>(sql`
    INSERT INTO ref_counters (tenant_id, entity, year, counter)
    VALUES (${tenantId}, ${entity}, ${year}, ${count})
    ON CONFLICT (tenant_id, entity, year)
    DO UPDATE SET counter = ref_counters.counter + ${count}
    RETURNING counter
  `);
  // The upsert returns the NEW high-water counter; the block is the `count`
  // numbers ending there, i.e. [last - count + 1, last].
  const last = Number((rows as unknown as { counter: number }[])[0].counter);
  const first = last - count + 1;
  return Array.from({ length: count }, (_, i) => formatRef(entity, year, first + i));
}
