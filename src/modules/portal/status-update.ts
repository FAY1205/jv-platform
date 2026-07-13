import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { leadWhere, type ScopeContext } from "@/lib/scope";
import { releasedLeads } from "../run/hold-filter";
import { isValidStatus, DEFAULT_STATUS } from "./statuses";

// PTL-03: a status update on an owned lead → lead_status_history (surfaced to the
// admin via the Activity feed + the status-change notification the route enqueues).
// Scoped (a partner can only update their own leads). PRN-05: historical assignments
// are untouched — this only appends status history. (WS-9/ADR-0020: the redundant
// `events` write was removed with the events table.)

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
export class LeadRemovedError extends Error {
  constructor(refId: string) {
    super(`Lead ${refId} was removed from MLS — its status is read-only.`);
    this.name = "LeadRemovedError";
  }
}

export async function updateLeadStatus(
  scope: ScopeContext,
  refId: string,
  status: string,
): Promise<{ refId: string; status: string; changed: boolean }> {
  if (!isValidStatus(status)) throw new InvalidStatusError(status);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [lead] = await tx
      .select({ id: schema.leads.id, tenantId: schema.leads.tenantId, mlsStatus: schema.leads.mlsStatus })
      .from(schema.leads)
      // WP-J2: a recalled (soft-deleted / voided-run) lead is not updatable — treat as not found.
      // Distribution hold: a held lead isn't the partner's yet, so it can't be acted on either.
      .where(and(leadWhere(scope), eq(schema.leads.refId, refId), isNull(schema.leads.deletedAt), scope.role === "partner" ? releasedLeads() : undefined));
    if (!lead) throw new LeadNotFoundError(refId);
    // PRN-04: a removed lead's status IS "Removed MLS" — refuse workflow overwrites.
    if (lead.mlsStatus === "removed") throw new LeadRemovedError(refId);

    // F-12: idempotent — if the lead is already at this status, do nothing (no dup
    // history row) and signal `changed:false` so the route skips the admin
    // notification too. PRN-05 safe. Deterministic tie-break on id.
    const [latest] = await tx
      .select({ status: schema.leadStatusHistory.status })
      .from(schema.leadStatusHistory)
      .where(eq(schema.leadStatusHistory.leadId, lead.id))
      .orderBy(desc(schema.leadStatusHistory.createdAt), desc(schema.leadStatusHistory.id))
      .limit(1);
    const current = latest?.status ?? DEFAULT_STATUS;
    if (current === status) return { refId, status, changed: false };

    await tx.insert(schema.leadStatusHistory).values({
      tenantId: lead.tenantId,
      leadId: lead.id,
      status,
      changedByUserId: scope.userId,
    });
    return { refId, status, changed: true };
  });
}
