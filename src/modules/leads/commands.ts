import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";

// ADM / ASN-03 write side. Manual assignment is ADDITIVE (PRN-05: the import
// snapshot — partnerId / matchMethod — is never rewritten). Only a currently
// UNMATCHED lead can be manually assigned; the action is audited (DM-04).

export class LeadNotFoundError extends Error {
  constructor() {
    super("Lead not found.");
    this.name = "LeadNotFoundError";
  }
}
export class LeadNotUnmatchedError extends Error {
  constructor() {
    super("Only an unmatched lead can be manually assigned.");
    this.name = "LeadNotUnmatchedError";
  }
}
export class InvalidAssignTargetError extends Error {
  constructor() {
    super("Choose an active partner to receive this lead.");
    this.name = "InvalidAssignTargetError";
  }
}

export interface ManualAssignInput {
  leadRef: string;
  partnerId: string;
  reason?: string;
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
          eq(schema.partners.status, "active"),
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
        manualReason: input.reason?.trim() || null,
      })
      .where(eq(schema.leads.id, lead.id));

    await tx.insert(schema.auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action: "lead.manually_assigned",
      entityType: "lead",
      entityRef: lead.refId,
      before: { partnerId: null, state: lead.state, zip: lead.zip },
      after: { manualPartnerId: partner.id, partnerRefId: partner.refId, reason: input.reason?.trim() || null },
      traceId: globalThis.crypto.randomUUID(),
    });

    return { partnerRefId: partner.refId };
  });
}
