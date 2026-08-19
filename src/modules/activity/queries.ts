import { and, asc, count, desc, eq, gte, ilike, isNull, lte, not, or, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, partnerOwnsLead, requirePartner, type ScopeContext } from "@/lib/scope";
import { releasedLeads } from "../run/hold-filter";
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
// `ilike` is case-insensitive (matches categorizeActivity's lower-casing); LIKE wildcards
// in the tokens (the `_` in "mls_pattern."/"source_profile.") are escaped so the match is
// literal, keeping exact parity with the pure categorizer's startsWith/includes.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
function securityCondition(): SQL {
  return or(
    ...SECURITY_PREFIXES.map((p) => ilike(schema.auditLog.action, `${escapeLike(p)}%`)),
    ...SECURITY_MARKERS.map((m) => ilike(schema.auditLog.action, `%${escapeLike(m)}%`)),
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
    // Same literal-match rule as securityCondition() above and the SRCH surfaces (WP-N4):
    // the user's text is escaped so `%`/`_` match literally instead of widening the filter
    // to every row. The pattern stays a bound parameter either way.
    const like = `%${escapeLike(query.q)}%`;
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
      // ADR-0013 defence-in-depth: `actor_user_id` is a bare uuid column — no FK, no tenant
      // correlation — and audit_log is APPEND-ONLY, so a row written with a foreign actor id
      // (a bug, a bad backfill) can never be corrected in place. Pinning the join to this
      // tenant means the worst case is a null actor, never another workspace's staff email.
      .leftJoin(schema.users, and(eq(schema.users.id, schema.auditLog.actorUserId), tenantWhere(schema.users, scope)))
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
    // Same ADR-0013 pin as listAdminActivity: the actor filter dropdown must never offer, or
    // resolve, a user from another tenant.
    .innerJoin(schema.users, and(eq(schema.users.id, schema.auditLog.actorUserId), tenantWhere(schema.users, scope)))
    .where(tenantWhere(schema.auditLog, scope))
    .orderBy(schema.users.email);
}

export interface PartnerActivityItem {
  when: string;
  kind: "status" | "note";
  detail: string;
}

export interface PartnerActivityPage {
  items: PartnerActivityItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ListPartnerActivityOpts {
  page?: number;
  pageSize?: number;
}

// WP-PP-5: selectable page size (matches the shared Pagination rows-per-page + the admin
// activity table); default 20 aligns with DEFAULT_PAGE_SIZE. Anything off-list degrades to
// the default (never throws) — same graceful posture as the portal leads route.
const ACTIVITY_PAGE_SIZES = [10, 20, 50] as const;
const DEFAULT_ACTIVITY_PAGE_SIZE = 20;

/** ACT-02: a partner's own actions on their own leads (status updates + notes). Server-side
 *  paginated with a real `total` so the shared Pagination primitive drives it (WP-PP-5). */
export async function listPartnerActivity(scope: ScopeContext, opts: ListPartnerActivityOpts = {}): Promise<PartnerActivityPage> {
  const db = getDb();
  const partnerId = requirePartner(scope);
  const current = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const pageSize = (ACTIVITY_PAGE_SIZES as readonly number[]).includes(opts.pageSize as number)
    ? (opts.pageSize as number)
    : DEFAULT_ACTIVITY_PAGE_SIZE;
  const window = current * pageSize; // bounded fetch, merged + paged in memory

  // The two sources share identical scope/lifecycle predicates; build once so the row
  // fetch and the count(*) below can never drift (count-consistency).
  const statusWhere = and(tenantWhere(schema.leadStatusHistory, scope), eq(schema.leadStatusHistory.changedByUserId, scope.userId), partnerOwnsLead(partnerId), isNull(schema.leads.deletedAt), releasedLeads());
  const noteWhere = and(tenantWhere(schema.leadNotes, scope), eq(schema.leadNotes.authorUserId, scope.userId), partnerOwnsLead(partnerId), isNull(schema.leads.deletedAt), releasedLeads());

  const [statuses, notes, statusCount, noteCount] = await Promise.all([
    db
      .select({ when: schema.leadStatusHistory.createdAt, status: schema.leadStatusHistory.status, ref: schema.leads.refId })
      .from(schema.leadStatusHistory)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadStatusHistory.leadId))
      // WP-J2: a recalled (soft-deleted) lead's activity must not surface. Distribution hold: nor a held one.
      .where(statusWhere)
      .orderBy(desc(schema.leadStatusHistory.createdAt))
      .limit(window),
    db
      .select({ when: schema.leadNotes.createdAt, ref: schema.leads.refId })
      .from(schema.leadNotes)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.leadNotes.leadId))
      .where(noteWhere)
      .orderBy(desc(schema.leadNotes.createdAt))
      .limit(window),
    db.select({ n: count() }).from(schema.leadStatusHistory).innerJoin(schema.leads, eq(schema.leads.id, schema.leadStatusHistory.leadId)).where(statusWhere),
    db.select({ n: count() }).from(schema.leadNotes).innerJoin(schema.leads, eq(schema.leads.id, schema.leadNotes.leadId)).where(noteWhere),
  ]);

  const merged: PartnerActivityItem[] = [
    ...statuses.map((s) => ({ when: s.when.toISOString(), kind: "status" as const, detail: `${s.ref} → ${s.status}` })),
    ...notes.map((n) => ({ when: n.when.toISOString(), kind: "note" as const, detail: `Note on ${n.ref}` })),
  ].sort((a, b) => (a.when < b.when ? 1 : -1));

  const offset = (current - 1) * pageSize;
  const total = (statusCount[0]?.n ?? 0) + (noteCount[0]?.n ?? 0);
  return { items: merged.slice(offset, offset + pageSize), page: current, pageSize, total };
}
