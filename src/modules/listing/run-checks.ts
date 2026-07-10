import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { LinkOnlyProvider } from "./link-only";
import type { ListingCheckProvider, ListingStatus } from "./provider";

// LST-01: run the listing check over a run's KEPT leads after the pipeline. It only
// records a check + updates the lead's flag — it NEVER removes a lead (LST-03/PRN-09)
// and never blocks the export (called after the run is persisted + stored).

type DB = PostgresJsDatabase<typeof schema>;

export async function runListingChecks(
  db: DB,
  scope: ScopeContext,
  uploadRef: string,
  provider: ListingCheckProvider = new LinkOnlyProvider(),
): Promise<number> {
  const [upload] = await db
    .select({ id: schema.uploads.id })
    .from(schema.uploads)
    .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.refId, uploadRef)));
  if (!upload) return 0;

  const leadRows = await db
    .select({ id: schema.leads.id, address: schema.leads.address, city: schema.leads.city, state: schema.leads.state, zip: schema.leads.zip })
    .from(schema.leads)
    .where(and(tenantWhere(schema.leads, scope), eq(schema.leads.uploadId, upload.id), eq(schema.leads.mlsStatus, "kept")));

  if (leadRows.length === 0) return 0;

  // F-08: one multi-row insert of all checks, then one UPDATE per distinct status
  // (LinkOnly yields a single status, so this is one statement in practice) — was
  // N inserts + N updates per run. LST-03: only the flag changes, never mls_status.
  const now = new Date();
  const checks = leadRows.map((lead) => ({ lead, r: provider.check(lead) }));

  await db.insert(schema.listingChecks).values(
    checks.map(({ lead, r }) => ({
      tenantId: scope.tenantId,
      leadId: lead.id,
      provider: r.provider,
      status: r.status,
      result: r.link ? { link: r.link } : null,
      checkedAt: now,
    })),
  );

  // LST-01: surface the flag on each lead, grouped by resulting status.
  const idsByStatus = new Map<ListingStatus, string[]>();
  for (const { lead, r } of checks) {
    const ids = idsByStatus.get(r.status) ?? [];
    ids.push(lead.id);
    idsByStatus.set(r.status, ids);
  }
  for (const [status, ids] of idsByStatus) {
    await db.update(schema.leads).set({ possibleMlsListing: status }).where(inArray(schema.leads.id, ids));
  }

  return leadRows.length;
}
