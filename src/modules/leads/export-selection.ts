import { and, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { ownerWhere, tenantWhere, type ScopeContext } from "@/lib/scope";
import { tagWhere } from "@/modules/tags/tags";
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
    // Projected explicitly, not `select()`: a bare star drags `raw_json` (the ENTIRE source
    // row, kept forever per DM-02), `score_breakdown` and `mls_match_span` through memory for
    // a set with no ceiling (owner A4) — none of which the workbook can use. Exactly the
    // `toExportLead` inputs, plus the manual overlay the effective owner needs.
    db
      .select({
        refId: schema.leads.refId,
        campaign: schema.leads.campaign,
        dateCreated: schema.leads.dateCreated,
        notes: schema.leads.notes,
        address: schema.leads.address,
        city: schema.leads.city,
        state: schema.leads.state,
        zip: schema.leads.zip,
        sellerFirst: schema.leads.sellerFirst,
        sellerLast: schema.leads.sellerLast,
        phone: schema.leads.phone,
        email: schema.leads.email,
        reasonForSelling: schema.leads.reasonForSelling,
        motivation: schema.leads.motivation,
        timeToSell: schema.leads.timeToSell,
        possibleMlsListing: schema.leads.possibleMlsListing,
        partnerId: schema.leads.partnerId,
        manualPartnerId: schema.leads.manualPartnerId,
      })
      .from(schema.leads)
      .where(and(...selectionConds(scope, selection)))
      .orderBy(schema.leads.refId),
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(tenantWhere(schema.partners, scope)),
    // `ownerWhere`, not a hand-rolled tenant + id pair: it is the ONE builder for "this row
    // belongs to the calling seat", and the per-USER axis is the one a cross-tenant isolation
    // test cannot catch — two seats inside one tenant both pass a tenant-only predicate.
    // Identical SQL today; what this buys is that the read moves with the guard.
    db.select({ email: schema.users.email }).from(schema.users).where(ownerWhere(schema.users, schema.users.id, scope)),
    filterTags.length === 0
      ? Promise.resolve([] as { id: string; name: string }[])
      : db
          .select({ id: schema.tags.id, name: schema.tags.name })
          .from(schema.tags)
          // `tagWhere` (modules/tags) rather than a raw `tenantWhere` on the same table — the
          // named builder is what tag visibility means, and every other tag read composes it.
          .where(and(tagWhere(scope), inArray(schema.tags.id, filterTags))),
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
