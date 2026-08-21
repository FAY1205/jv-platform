import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { toExportLead, type ExportLead, type PartnerInfo } from "../export/render";
import { selectionConds } from "./bulk";
import { canonicalBulkFilters, type BulkSelection } from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// WP-N6 (N6-40..44) — everything the selection export needs, read under scope.
//
// The set is resolved through `selectionConds` — the SAME predicate the three bulk writes
// use, which is itself the list's `leadsFilterConds` (PRN-08 + PRN-15). "Export what I
// selected" therefore means exactly what "assign what I selected" means, and neither can be
// composed without its scope half.
//
// Refs that resolve to nothing are simply absent from the workbook. There is no skip report:
// an export is a READ, so an unresolved ref changes nothing and has nothing to undo — the
// summary sheet's requested-vs-exported counts are where a discrepancy shows up. (A write
// reports them because a write leaves the world half-changed; this does not.)
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectionExportData {
  exportLeads: ExportLead[];
  partners: Map<string, PartnerInfo>;
  /** The exporting seat's email, for the `Selection_Summary` "Exported by" row (N6-42). */
  exportedBy: string;
  /** Display names for the tag ids named in a filter selection — the filter sentence must say
   *  "tagged Probate", not a uuid. Empty in refs mode. */
  tagNames: Map<string, string>;
}

/**
 * Owner A4: no artificial ceiling on the filter arm. That is a deliberate trade — the whole
 * matching set has to be materialised to be written into a workbook, so a very large tenant
 * escalating to "everything" builds a large response in memory. The confirm dialog's count is
 * the guard the owner chose; a streaming writer is a separate ask, not a rider here.
 */
export async function getSelectionExportData(
  scope: ScopeContext,
  selection: BulkSelection,
): Promise<SelectionExportData> {
  const db = getDb();
  const filterTags = selection.mode === "filter" ? canonicalBulkFilters(selection.filters).tags : [];

  const [leadRows, partnerRows, actorRows, tagRows] = await Promise.all([
    // Ordered by ref so two exports of an unchanged selection produce the same sheet — the
    // grouping is stable, but row order WITHIN a partner would otherwise be whatever the
    // planner returned (TST-05 determinism is a property of this query too, not just the
    // renderer).
    db
      .select()
      .from(schema.leads)
      .where(and(...selectionConds(scope, selection)))
      .orderBy(schema.leads.refId),
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(tenantWhere(schema.partners, scope)),
    db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(and(tenantWhere(schema.users, scope), eq(schema.users.id, scope.userId))),
    filterTags.length === 0
      ? Promise.resolve([] as { id: string; name: string }[])
      : db
          .select({ id: schema.tags.id, name: schema.tags.name })
          .from(schema.tags)
          .where(and(tenantWhere(schema.tags, scope), inArray(schema.tags.id, filterTags))),
  ]);

  return {
    // The EFFECTIVE owner (`manual_partner_id ?? partner_id`), which is what the leads list
    // shows and what the partner filter selects on. Grouping by the import snapshot instead
    // would file a manually re-routed lead under the partner it no longer belongs to — the
    // workbook would contradict the screen the operator selected it from. (The run export
    // groups by the snapshot on purpose: that deliverable IS the run.)
    exportLeads: leadRows.map((l) => toExportLead({ ...l, partnerId: l.manualPartnerId ?? l.partnerId })),
    partners: new Map(partnerRows.map((p) => [p.id, { id: p.id, name: p.name, refId: p.refId, color: p.color }])),
    // A seat with no `users` row cannot reach a capability gate, so this is defensive rather
    // than expected — an empty cell beats a crash in a deliverable.
    exportedBy: actorRows[0]?.email ?? "",
    tagNames: new Map(tagRows.map((t) => [t.id, t.name])),
  };
}
