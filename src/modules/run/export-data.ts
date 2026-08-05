import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, leadWhere, type ScopeContext } from "@/lib/scope";
import { computeRunSummary } from "../analytics/run-summary";
import { toExportLead, type ExportLead, type PartnerInfo } from "../export/render";
import type { RunSummary } from "../analytics/run-summary";

// ─────────────────────────────────────────────────────────────────────────────
// Full export data for a run (WP-020). Re-renders the deliverable .xlsx from persisted
// leads on download (EXP-05 blob storage is deferred; the rules snapshot pins determinism,
// so regeneration is faithful). Scoped read (PRN-08). Includes the seller fields the export
// contract needs — server-side only, for the admin's download.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunExportData {
  refId: string;
  exportLeads: ExportLead[];
  partners: Map<string, PartnerInfo>;
  summary: RunSummary;
}

export async function getRunExportData(scope: ScopeContext, ref: string): Promise<RunExportData | null> {
  const db = getDb();
  const [upload] = await db
    .select({ id: schema.uploads.id, refId: schema.uploads.refId })
    .from(schema.uploads)
    .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.refId, ref)));
  if (!upload) return null;

  const [leadRows, partnerRows] = await Promise.all([
    // WP-J2: exclude recalled (soft-deleted / voided-run) leads from the deliverable.
    db.select().from(schema.leads).where(and(leadWhere(scope), eq(schema.leads.uploadId, upload.id), isNull(schema.leads.deletedAt))),
    db.select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color }).from(schema.partners).where(tenantWhere(schema.partners, scope)),
  ]);

  const partners = new Map<string, PartnerInfo>(partnerRows.map((p) => [p.id, { id: p.id, name: p.name, refId: p.refId, color: p.color }]));

  const summary = computeRunSummary(
    leadRows.map((l) => ({ mlsStatus: l.mlsStatus, matchMethod: l.matchMethod, partnerId: l.partnerId })),
  );

  // The partner deliverable is the kept leads; removed (MLS) are summarised only.
  // Admin download keeps Campaign (lead source). Shape built by the one serializer (R-11).
  const exportLeads: ExportLead[] = leadRows.filter((l) => l.mlsStatus === "kept").map((l) => toExportLead(l));

  return { refId: upload.refId, exportLeads, partners, summary };
}
