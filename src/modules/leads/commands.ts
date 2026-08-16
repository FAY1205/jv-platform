import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { computeDedupeKey, normalizeAddress } from "@/modules/pipeline/normalize";
import { isAuditPiiLeadField, maskAuditValue } from "@/modules/audit/redact";
import { unmatchedCoverageLeadRefs } from "./queries";
import { LeadNotFoundError } from "./errors";

// ADM / ASN-03 write side. Manual assignment is ADDITIVE (PRN-05: the import
// snapshot — partnerId / matchMethod — is never rewritten). Only a currently
// UNMATCHED lead can be manually assigned; the action is audited (DM-04).

// LeadNotFoundError is shared (C-5) — re-export the one class so every route's instanceof matches.
export { LeadNotFoundError };
export class LeadNotUnmatchedError extends Error {
  constructor() {
    super("Only an unmatched lead can be manually assigned.");
    this.name = "LeadNotUnmatchedError";
  }
}
export class InvalidAssignTargetError extends Error {
  constructor() {
    super("Choose a partner that hasn't been deactivated.");
    this.name = "InvalidAssignTargetError";
  }
}
export class CannotUnassignRoutedLeadError extends Error {
  constructor() {
    super("A pipeline-routed lead can't be unassigned; revert to original routing instead.");
    this.name = "CannotUnassignRoutedLeadError";
  }
}

export interface ManualAssignInput {
  leadRef: string;
  partnerId: string;
}

/** Manually route an unmatched lead to a partner (fills the gap, never rewrites
 *  history). Returns the partner's ref for the caller's confirmation message. */
export async function manuallyAssignLead(scope: ScopeContext, input: ManualAssignInput): Promise<{ partnerRefId: string }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [lead] = await tx
      .select({
        id: schema.leads.id,
        refId: schema.leads.refId,
        partnerId: schema.leads.partnerId,
        manualPartnerId: schema.leads.manualPartnerId,
        mlsStatus: schema.leads.mlsStatus,
        state: schema.leads.state,
        zip: schema.leads.zip,
      })
      .from(schema.leads)
      .where(and(tenantWhere(schema.leads, scope), eq(schema.leads.refId, input.leadRef), isNull(schema.leads.deletedAt)));

    if (!lead) throw new LeadNotFoundError();
    // Unmatched = kept, not pipeline-routed, not already manually assigned.
    if (lead.mlsStatus !== "kept" || lead.partnerId !== null || lead.manualPartnerId !== null) {
      throw new LeadNotUnmatchedError();
    }

    const [partner] = await tx
      .select({ id: schema.partners.id, refId: schema.partners.refId })
      .from(schema.partners)
      .where(
        and(
          tenantWhere(schema.partners, scope),
          eq(schema.partners.id, input.partnerId),
          ne(schema.partners.status, "revoked"),
          isNull(schema.partners.deletedAt),
        ),
      );
    if (!partner) throw new InvalidAssignTargetError();

    await tx
      .update(schema.leads)
      .set({
        manualPartnerId: partner.id,
        manualAssignedAt: new Date(),
        manualAssignedBy: scope.userId,
      })
      .where(eq(schema.leads.id, lead.id));

    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "lead.manually_assigned",
      entityType: "lead",
      entityRef: lead.refId,
      before: { partnerId: null, state: lead.state, zip: lead.zip },
      // No free text here (owner decision 2026-07-15): the reason field was removed
      // rather than masked. Admin free text is where humans paste seller PII, and this
      // trail is append-only — a field that cannot hold PII cannot leak it. WHO routed
      // WHICH lead to WHOM, and when, is the audit-relevant part (DM-04).
      after: { manualPartnerId: partner.id, partnerRefId: partner.refId },
      traceId: globalThis.crypto.randomUUID(),
    });

    return { partnerRefId: partner.refId };
  });
}

// ── Bulk manual assignment (S6 / ASN-03) ───────────────────────────────────────

export interface BulkAssignInput {
  leadRefs: string[];
  partnerId: string;
}

export interface BulkAssignResult {
  partnerRefId: string;
  /** Refs actually assigned (were eligible: kept, no snapshot owner, no overlay). */
  assigned: string[];
  /** Refs requested but not assigned (already routed/assigned, removed, or unknown). */
  skipped: string[];
}

/**
 * Assign many unmatched leads to one partner in a single transaction. Same
 * PRN-05-clean semantics as manuallyAssignLead — only the additive manual overlay
 * is written, and only for leads that are STILL unmatched at write time (the
 * eligibility filter doubles as the race guard: a lead someone else just routed
 * simply lands in `skipped`). One audit row per lead (DM-04), flagged `bulk`.
 */
export async function bulkAssignLeads(scope: ScopeContext, input: BulkAssignInput): Promise<BulkAssignResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [partner] = await tx
      .select({ id: schema.partners.id, refId: schema.partners.refId })
      .from(schema.partners)
      .where(
        and(
          tenantWhere(schema.partners, scope),
          eq(schema.partners.id, input.partnerId),
          ne(schema.partners.status, "revoked"),
          isNull(schema.partners.deletedAt),
        ),
      );
    if (!partner) throw new InvalidAssignTargetError();
    if (input.leadRefs.length === 0) return { partnerRefId: partner.refId, assigned: [], skipped: [] };

    const eligible = await tx
      .select({ id: schema.leads.id, refId: schema.leads.refId, state: schema.leads.state, zip: schema.leads.zip })
      .from(schema.leads)
      .where(
        and(
          tenantWhere(schema.leads, scope),
          inArray(schema.leads.refId, input.leadRefs),
          isNull(schema.leads.deletedAt),
          eq(schema.leads.mlsStatus, "kept"),
          isNull(schema.leads.partnerId),
          isNull(schema.leads.manualPartnerId),
        ),
      )
      .orderBy(schema.leads.refId);

    const assignedRefs = new Set(eligible.map((l) => l.refId));
    const skipped = input.leadRefs.filter((r) => !assignedRefs.has(r));
    if (eligible.length > 0) {
      await tx
        .update(schema.leads)
        .set({ manualPartnerId: partner.id, manualAssignedAt: new Date(), manualAssignedBy: scope.userId })
        .where(inArray(schema.leads.id, eligible.map((l) => l.id)));
      // Same no-free-text audit shape as the single assign (owner decision 2026-07-15).
      await tx.insert(schema.auditLog).values(
        eligible.map((l) => ({
          tenantId: scope.tenantId,
          actorUserId: scope.userId,
          action: "lead.manually_assigned",
          entityType: "lead",
          entityRef: l.refId,
          before: { partnerId: null, state: l.state, zip: l.zip },
          after: { manualPartnerId: partner.id, partnerRefId: partner.refId, ...(input.leadRefs.length > 1 ? { bulk: true } : {}) },
          traceId: globalThis.crypto.randomUUID(),
        })),
      );
    }
    return { partnerRefId: partner.refId, assigned: eligible.map((l) => l.refId), skipped };
  });
}

/**
 * Coverage backfill (owner note #2): assign every unmatched lead the partner's
 * CURRENT coverage would route to them. Derives the matching refs (zip override
 * beats state rule, ASN-02-generic), then reuses bulkAssignLeads — whose
 * still-unmatched eligibility guard also covers the derive→write race.
 */
export async function bulkAssignByCoverage(scope: ScopeContext, partnerId: string): Promise<BulkAssignResult> {
  const leadRefs = await unmatchedCoverageLeadRefs(scope, partnerId);
  return bulkAssignLeads(scope, { leadRefs, partnerId });
}

// ── Admin lead edit (ADM) — powers the Leads dialog "Edit everything" mode ─────
// Corrects the canonical display fields (seller / property / contact / context)
// and optionally re-routes the EFFECTIVE owner. PRN-05: the import snapshot
// (partnerId / matchMethod) is NEVER rewritten — re-routing only ever writes the
// additive manual overlay (manual_partner_id). Every edit is audited (DM-04).

export interface EditLeadFields {
  sellerFirst?: string;
  sellerLast?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  campaign?: string;
  reasonForSelling?: string;
  motivation?: string;
  timeToSell?: string;
  notes?: string;
}

/** Partner re-routing intent for an edit. "keep" leaves ownership untouched;
 *  "set" writes the manual overlay to a partner; "revert" clears the overlay so
 *  the lead falls back to its pipeline routing; "unassign" clears the overlay to
 *  leave the lead owner-less — valid only when there is no pipeline snapshot to
 *  fall back to (PRN-05: the snapshot is immutable and can never be nulled). */
export type PartnerEdit =
  | { action: "keep" }
  | { action: "set"; partnerId: string }
  | { action: "revert" }
  | { action: "unassign" };

export interface EditLeadInput {
  ref: string;
  fields: EditLeadFields;
  partner: PartnerEdit;
}

/**
 * The lead columns an admin edit may change — and therefore the only ones that can
 * ever reach the append-only audit trail's before/after. Exported so the ADR-0031
 * lockstep test can DERIVE which purge-worthy columns must be masked, instead of
 * re-listing them by hand (a hand-copied list is what let `address` slip through).
 */
export const EDITABLE_COLUMNS = [
  "sellerFirst",
  "sellerLast",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "zip",
  "campaign",
  "reasonForSelling",
  "motivation",
  "timeToSell",
  "notes",
] as const;

export async function editLead(
  scope: ScopeContext,
  input: EditLeadInput,
): Promise<{ refId: string; assignedPartnerId: string | null }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [lead] = await tx
      .select()
      .from(schema.leads)
      .where(and(tenantWhere(schema.leads, scope), eq(schema.leads.refId, input.ref), isNull(schema.leads.deletedAt)));
    if (!lead) throw new LeadNotFoundError();

    // Build the canonical-field patch (only changed keys) for the update + audit diff.
    const patch: Record<string, string | null> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const col of EDITABLE_COLUMNS) {
      const next = input.fields[col];
      if (next === undefined) continue;
      const clean = next.trim() === "" ? null : next.trim();
      if (clean !== (lead[col] ?? null)) {
        patch[col] = clean;
        // SEC-05 (ADR-0031): the leads row keeps the real value via `patch`, but the
        // append-only audit trail must never hold raw consumer PII — mask PII fields to
        // a presence sentinel. Routing/property fields stay raw: their old→new is the
        // audit-relevant part of an edit (DM-04).
        if (isAuditPiiLeadField(col)) {
          before[col] = maskAuditValue(lead[col]);
          after[col] = maskAuditValue(clean);
        } else {
          before[col] = lead[col] ?? null;
          after[col] = clean;
        }
      }
    }

    // Address/zip drive the dedupe key + normalized address (DM-01). Recompute both
    // when either changes so future dedupe / PRN-05 "revert to original" stay consistent
    // (audit F-01 data facet). The import snapshot (partnerId/matchMethod) is untouched.
    // A recomputed key can collide with the (tenant, dedupe_key) unique index if the new
    // address matches another lead — the tx then rolls back and the route surfaces it.
    if ("address" in patch || "zip" in patch) {
      const nextAddress = "address" in patch ? patch.address : lead.address;
      const nextZip = "zip" in patch ? patch.zip : lead.zip;
      patch.addressNormalized = normalizeAddress(nextAddress);
      patch.dedupeKey = computeDedupeKey(nextAddress, nextZip);
    }

    // Effective owner today = manual overlay if present, else the pipeline snapshot.
    const currentEffective = lead.manualPartnerId ?? lead.partnerId;
    let partnerAudit: Record<string, unknown> | null = null;
    // F-40: the partner a "set" re-route newly hands the lead to (null otherwise) —
    // the route uses it to notify the receiving partner. Only a real change qualifies.
    let assignedPartnerId: string | null = null;

    if (input.partner.action === "set") {
      const [partner] = await tx
        .select({ id: schema.partners.id, refId: schema.partners.refId })
        .from(schema.partners)
        .where(
          and(
            tenantWhere(schema.partners, scope),
            eq(schema.partners.id, input.partner.partnerId),
            ne(schema.partners.status, "revoked"),
            isNull(schema.partners.deletedAt),
          ),
        );
      if (!partner) throw new InvalidAssignTargetError();
      // Only write the overlay when it actually changes the effective owner.
      if (partner.id !== currentEffective) {
        patch.manualPartnerId = partner.id;
        patch.manualAssignedAt = new Date() as unknown as string;
        patch.manualAssignedBy = scope.userId;
        partnerAudit = { from: currentEffective, to: partner.id, partnerRefId: partner.refId };
        assignedPartnerId = partner.id;
      }
    } else if (input.partner.action === "revert" && lead.manualPartnerId !== null) {
      patch.manualPartnerId = null;
      patch.manualAssignedAt = null;
      patch.manualAssignedBy = null;
      partnerAudit = { from: lead.manualPartnerId, to: lead.partnerId, reverted: true };
    } else if (input.partner.action === "unassign") {
      // PRN-05: only the additive manual overlay can be cleared — the pipeline snapshot
      // (partnerId) is immutable. A lead whose snapshot routed it to a partner can never
      // be made owner-less; the admin must Revert to original routing instead. This
      // mirrors manuallyAssignLead's guard (only an unmatched-base lead is in play).
      if (lead.partnerId !== null) throw new CannotUnassignRoutedLeadError();
      if (lead.manualPartnerId !== null) {
        patch.manualPartnerId = null;
        patch.manualAssignedAt = null;
        patch.manualAssignedBy = null;
          partnerAudit = { from: currentEffective, to: null, unassigned: true };
      }
      // else: partnerId and manualPartnerId both null → already owner-less; no-op.
    }

    if (Object.keys(patch).length === 0) return { refId: lead.refId, assignedPartnerId };

    await tx.update(schema.leads).set(patch).where(eq(schema.leads.id, lead.id));

    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "lead.edited",
      entityType: "lead",
      entityRef: lead.refId,
      before: { ...before, ...(partnerAudit ? { effectiveOwner: partnerAudit.from } : {}) },
      after: { ...after, ...(partnerAudit ? { effectiveOwner: partnerAudit.to, partner: partnerAudit } : {}) },
      traceId: globalThis.crypto.randomUUID(),
    });

    return { refId: lead.refId, assignedPartnerId };
  });
}
