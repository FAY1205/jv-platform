import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, requirePartner, type ScopeContext } from "@/lib/scope";
import { categorizeActivity, type ActivityCategory } from "./categorize";

// ACT-01/02/04 read side. Admin sees the tenant's audit trail (scoped, PRN-08),
// security events highlighted. A partner sees ONLY their own actions on their leads.

export interface AdminActivityItem {
  id: string;
  when: string;
  actor: string | null;
  action: string;
  entityType: string;
  entityRef: string | null;
  category: ActivityCategory;
  before: unknown;
  after: unknown;
}
export interface AdminActivityPage {
  items: AdminActivityItem[];
  page: number;
  pageSize: number;
  total: number;
}

const PAGE_SIZE = 50;

/** ACT-01: the tenant's audit trail, newest first, paginated. */
export async function listAdminActivity(scope: ScopeContext, page = 1): Promise<AdminActivityPage> {
  const db = getDb();
  const current = Math.max(1, Math.floor(page) || 1);
  const offset = (current - 1) * PAGE_SIZE;

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: schema.auditLog.id,
        createdAt: schema.auditLog.createdAt,
        actor: schema.users.email,
        action: schema.auditLog.action,
        entityType: schema.auditLog.entityType,
        entityRef: schema.auditLog.entityRef,
        before: schema.auditLog.before,
        after: schema.auditLog.after,
      })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorUserId))
      .where(tenantWhere(schema.auditLog, scope))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.select({ n: count() }).from(schema.auditLog).where(tenantWhere(schema.auditLog, scope)),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      when: r.createdAt.toISOString(),
      actor: r.actor,
      action: r.action,
      entityType: r.entityType,
      entityRef: r.entityRef,
      category: categorizeActivity(r.action),
      before: r.before,
      after: r.after,
    })),
    page: current,
    pageSize: PAGE_SIZE,
    total: Number(totals[0]?.n ?? 0),
  };
}

export interface PartnerActivityItem {
  when: string;
  kind: "status" | "note";
  detail: string;
}

/** ACT-02: a partner's own actions on their own leads (status updates + notes). */
export async function listPartnerActivity(scope: ScopeContext, page = 1): Promise<{ items: PartnerActivityItem[]; page: number; pageSize: number }> {
  const db = getDb();
  const partnerId = requirePartner(scope);
  const current = Math.max(1, Math.floor(page) || 1);
  const window = current * PAGE_SIZE; // bounded fetch, merged + paged in memory

  const [statuses, notes] = await Promise.all([
    db
      .select({ when: schema.leadStatusHistory.createdAt, status: schema.leadStatusHistory.status, ref: schema.leads.refId })
      .from(schema.leadStatusHistory)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadStatusHistory.leadId))
      .where(and(tenantWhere(schema.leadStatusHistory, scope), eq(schema.leadStatusHistory.changedByUserId, scope.userId), eq(schema.leads.partnerId, partnerId)))
      .orderBy(desc(schema.leadStatusHistory.createdAt))
      .limit(window),
    db
      .select({ when: schema.leadNotes.createdAt, ref: schema.leads.refId })
      .from(schema.leadNotes)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadNotes.leadId))
      .where(and(tenantWhere(schema.leadNotes, scope), eq(schema.leadNotes.authorUserId, scope.userId), eq(schema.leads.partnerId, partnerId)))
      .orderBy(desc(schema.leadNotes.createdAt))
      .limit(window),
  ]);

  const merged: PartnerActivityItem[] = [
    ...statuses.map((s) => ({ when: s.when.toISOString(), kind: "status" as const, detail: `${s.ref} → ${s.status}` })),
    ...notes.map((n) => ({ when: n.when.toISOString(), kind: "note" as const, detail: `Note on ${n.ref}` })),
  ].sort((a, b) => (a.when < b.when ? 1 : -1));

  const offset = (current - 1) * PAGE_SIZE;
  return { items: merged.slice(offset, offset + PAGE_SIZE), page: current, pageSize: PAGE_SIZE };
}
