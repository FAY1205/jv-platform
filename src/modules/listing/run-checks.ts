import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { LinkOnlyProvider } from "./link-only";
import type { ListingCheckProvider } from "./provider";

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

  const now = new Date();
  for (const lead of leadRows) {
    const r = provider.check(lead);
    await db.insert(schema.listingChecks).values({
      tenantId: scope.tenantId,
      leadId: lead.id,
      provider: r.provider,
      status: r.status,
      result: r.link ? { link: r.link } : null,
      checkedAt: now,
    });
    // LST-01: surface the flag on the lead. LST-03: only the flag changes, never mls_status.
    await db.update(schema.leads).set({ possibleMlsListing: r.status }).where(eq(schema.leads.id, lead.id));
  }
  return leadRows.length;
}
