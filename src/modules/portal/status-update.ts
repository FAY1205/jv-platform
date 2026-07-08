import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { leadWhere, type ScopeContext } from "@/lib/scope";
import { isValidStatus } from "./statuses";

// PTL-03: a status update on an owned lead → lead_status_history + event (visible to
// admin). Scoped (a partner can only update their own leads). PRN-05: historical
// assignments are untouched — this only appends status history.

export class LeadNotFoundError extends Error {
  constructor(refId: string) {
    super(`Lead ${refId} not found.`);
    this.name = "LeadNotFoundError";
  }
}
export class InvalidStatusError extends Error {
  constructor(status: string) {
    super(`Unknown status: ${status}`);
    this.name = "InvalidStatusError";
  }
}

export async function updateLeadStatus(
  scope: ScopeContext,
  refId: string,
  status: string,
): Promise<{ refId: string; status: string }> {
  if (!isValidStatus(status)) throw new InvalidStatusError(status);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [lead] = await tx
      .select({ id: schema.leads.id, tenantId: schema.leads.tenantId })
      .from(schema.leads)
      .where(and(leadWhere(scope), eq(schema.leads.refId, refId)));
    if (!lead) throw new LeadNotFoundError(refId);

    await tx.insert(schema.leadStatusHistory).values({
      tenantId: lead.tenantId,
      leadId: lead.id,
      status,
      changedByUserId: scope.userId,
    });
    await tx.insert(schema.events).values({
      tenantId: lead.tenantId,
      type: "status.changed",
      payload: { leadRefId: refId, status, byRole: scope.role },
    });
    return { refId, status };
  });
}
