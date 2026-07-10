import { and, asc, count, desc, eq, gte, ilike, lte, not, or, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, partnerOwnsLead, requirePartner, type ScopeContext } from "@/lib/scope";
import { categorizeActivity, SECURITY_PREFIXES, SECURITY_MARKERS, type ActivityCategory } from "./categorize";
import type { ActivityQuery } from "./schema";

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

// ACT-04: the security/data split as a SQL predicate, built from the SAME prefixes/markers
// categorizeActivity uses — so a server-side "security only" filter paginates correctly.
// `ilike` is case-insensitive, matching categorizeActivity's lower-casing.
function securityCondition(): SQL {
  return or(
    ...SECURITY_PREFIXES.map((p) => ilike(schema.auditLog.action, `${p}%`)),
    ...SECURITY_MARKERS.map((m) => ilike(schema.auditLog.action, `%${m}%`)),
  )!;
}

/** ACT-01: the tenant's audit trail, filtered + paginated server-side. */
export async function listAdminActivity(scope: ScopeContext, query: ActivityQuery): Promise<AdminActivityPage> {
  const db = getDb();
  const offset = (query.page - 1) * query.pageSize;

  const conds: SQL[] = [tenantWhere(schema.auditLog, scope)];
  if (query.category === "security") conds.push(securityCondition());
  else if (query.category === "data") conds.push(not(securityCondition()));
  if (query.actor) conds.push(eq(schema.auditLog.actorUserId, query.actor));
  if (query.dateFrom) conds.push(gte(schema.auditLog.createdAt, new Date(`${query.dateFrom}T00:00:00Z`)));
  if (query.dateTo) conds.push(lte(schema.auditLog.createdAt, new Date(`${query.dateTo}T23:59:59Z`)));
  if (query.q) {
    const like = `%${query.q}%`;
    conds.push(or(ilike(schema.auditLog.action, like), ilike(schema.auditLog.entityRef, like))!);
  }
  const where = and(...conds);
  const dirFn = query.dir === "asc" ? asc : desc;

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
      .where(where)
      .orderBy(dirFn(schema.auditLog.createdAt))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ n: count() }).from(schema.auditLog).where(where),
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
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totals[0]?.n ?? 0),
  };
}

/** Distinct actors present in this tenant's audit trail — powers the activity actor filter. */
export async function listActivityActors(scope: ScopeContext): Promise<{ id: string; email: string }[]> {
  return getDb()
    .selectDistinct({ id: schema.users.id, email: schema.users.email })
    .from(schema.auditLog)
    .innerJoin(schema.users, eq(schema.users.id, schema.auditLog.actorUserId))
    .where(tenantWhere(schema.auditLog, scope))
    .orderBy(schema.users.email);
}

export interface PartnerActivityItem {
  when: string;
  kind: "status" | "note";
  detail: string;
}

const PAGE_SIZE = 50; // partner activity: bounded fetch merged + paged in memory

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
      .where(and(tenantWhere(schema.leadStatusHistory, scope), eq(schema.leadStatusHistory.changedByUserId, scope.userId), partnerOwnsLead(partnerId)))
      .orderBy(desc(schema.leadStatusHistory.createdAt))
      .limit(window),
    db
      .select({ when: schema.leadNotes.createdAt, ref: schema.leads.refId })
      .from(schema.leadNotes)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadNotes.leadId))
      .where(and(tenantWhere(schema.leadNotes, scope), eq(schema.leadNotes.authorUserId, scope.userId), partnerOwnsLead(partnerId)))
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
