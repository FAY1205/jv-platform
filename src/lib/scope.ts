import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// The scoping guard (PRN-08). Every query in API routes builds its WHERE clause
// from here — tenant scoping is enforced in application code AND in Postgres RLS
// (SEC-01). The client is never trusted. These builders are the app-layer half;
// the RLS policies (0001 migration) are the database half. TST-01 proves both.
// ─────────────────────────────────────────────────────────────────────────────

const { leads, leadNotes, leadTasks, users } = schema;
type DB = PostgresJsDatabase<typeof schema>;

export interface ScopeContext {
  tenantId: string;
  role: "admin" | "partner";
  userId: string;
  /** Required when role === "partner". */
  partnerId?: string;
}

/** Guard: a partner scope must carry a partnerId, or it is a programming error. */
export function requirePartner(scope: ScopeContext): string {
  if (scope.role === "partner" && !scope.partnerId) {
    throw new Error("Partner scope is missing partnerId — refusing to build an unscoped query.");
  }
  return scope.partnerId as string;
}

/** Tenant-only scope for any table with a tenantId column. */
export function tenantWhere<T extends { tenantId: PgColumn }>(table: T, scope: ScopeContext): SQL {
  return eq(table.tenantId, scope.tenantId);
}

/** System-job scope: background jobs (outbox drain, retention sweeps) hold a tenantId
 *  STRING, not a ScopeContext, so they can't call tenantWhere. Same predicate, in one
 *  sanctioned place — a future change to tenant filtering reaches them too, instead of
 *  the hand-rolled `eq(table.tenantId, id)` copies the guard's evolution would miss (R-24). */
export function tenantIdWhere<T extends { tenantId: PgColumn }>(table: T, tenantId: string): SQL {
  return eq(table.tenantId, tenantId);
}

/**
 * PER-USER scope: this tenant AND rows owned by the CALLING user (audit-tenancy F-3). The
 * owner column is passed in because it is named differently per table (`notifications.user_id`,
 * `saved_views.user_id`, and any future `*_user_id`) — what is shared is the RULE, not the name:
 * a tenant pin AND-ed with the caller's identity, never one without the other.
 *
 * This is R-24's argument one axis over. `tenantIdWhere` exists because hand-rolled
 * `eq(table.tenantId, id)` copies would miss a future change to tenant filtering; the per-user
 * pin had grown its own independent copies for exactly the same reason, and it is the axis
 * where a dropped half is least visible — a user-scoped table shares its tenant with every
 * colleague, so losing the user pin leaks sideways WITHIN a tenant, which no cross-tenant probe
 * would ever catch. One definition, so a change reaches every caller.
 */
export function ownerWhere<T extends { tenantId: PgColumn }>(
  table: T,
  ownerColumn: PgColumn,
  scope: ScopeContext,
): SQL {
  return and(eq(table.tenantId, scope.tenantId), eq(ownerColumn, scope.userId))!;
}

/** A partner "owns" a lead if it is their EFFECTIVE owner: the manual overlay when
 *  present, else the pipeline snapshot — i.e. coalesce(manualPartnerId, partnerId) = me.
 *  Re-routing a MATCHED lead to another partner (editLead "set") REVOKES the original
 *  pipeline partner's access, so the two predicates DO overlap once a matched lead is
 *  re-routed; this is not a plain union (audit F-01 / ASN-04). The one place partner
 *  lead-ownership is defined; every partner-scoped read uses it. */
export function partnerOwnsLead(me: string): SQL {
  return or(eq(leads.manualPartnerId, me), and(isNull(leads.manualPartnerId), eq(leads.partnerId, me)))!;
}

/** Leads visibility: tenant + (admin sees all · partner sees only their own). */
export function leadWhere(scope: ScopeContext): SQL {
  const base = eq(leads.tenantId, scope.tenantId);
  if (scope.role === "admin") return base;
  return and(base, partnerOwnsLead(requirePartner(scope)))!;
}

/**
 * Lead notes visibility (PRN-13): admin sees only admin notes; a partner sees only
 * their own partner notes on their own leads. Cross-role notes are never returned.
 */
export function noteWhere(scope: ScopeContext, db: DB): SQL {
  const base = eq(leadNotes.tenantId, scope.tenantId);
  if (scope.role === "admin") {
    return and(base, eq(leadNotes.authorRole, "admin"))!;
  }
  const me = requirePartner(scope);
  const ownLeads = db
    .select({ id: leads.id })
    .from(leads)
    // WP-J2 / DM-09b: a partner's owned-lead set excludes recalled (soft-deleted) leads, so the
    // guard is self-sufficient — child-table reads never rely on a parent join to filter deletes.
    .where(and(eq(leads.tenantId, scope.tenantId), partnerOwnsLead(me), isNull(leads.deletedAt)));
  // A note belongs to the partner org that wrote it (PRN-08/PRN-13): lead ownership MOVES
  // on re-route (partnerOwnsLead), so "notes on leads I own" alone would hand the previous
  // partner's notes to the new one. Restrict to notes authored by the reading partner's own org.
  const ownAuthors = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, scope.tenantId), eq(users.partnerId, me)));
  return and(
    base,
    eq(leadNotes.authorRole, "partner"),
    inArray(leadNotes.leadId, ownLeads),
    inArray(leadNotes.authorUserId, ownAuthors),
  )!;
}

/**
 * Lead tasks visibility (TSK-02, ADR-0044): the two-stream notes model, not the
 * status-history model. Admin sees only admin tasks; a partner sees only tasks authored
 * by their own org on leads they currently own. Lead ownership MOVES on re-route
 * (partnerOwnsLead), so "tasks on leads I own" alone would hand the previous partner's
 * tasks to the new owner — the own-org author predicate closes that, exactly as
 * noteWhere does for notes. The RLS policy lead_tasks_scope (migration 0041) carries
 * the identical READ predicate, and its WITH CHECK additionally pins author identity,
 * stream, and in-tenant references on writes (SEC-01; audit-tenancy F-1) — keep both
 * halves in lockstep with this builder.
 */
export function taskWhere(scope: ScopeContext, db: DB): SQL {
  const base = eq(leadTasks.tenantId, scope.tenantId);
  if (scope.role === "admin") {
    return and(base, eq(leadTasks.authorRole, "admin"))!;
  }
  const me = requirePartner(scope);
  const ownLeads = db
    .select({ id: leads.id })
    .from(leads)
    // DM-09b: recalled (soft-deleted) leads drop out of the owned set here, so task reads
    // never rely on a parent join to filter deletes (same discipline as noteWhere).
    .where(and(eq(leads.tenantId, scope.tenantId), partnerOwnsLead(me), isNull(leads.deletedAt)));
  const ownAuthors = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, scope.tenantId), eq(users.partnerId, me)));
  return and(
    base,
    eq(leadTasks.authorRole, "partner"),
    inArray(leadTasks.leadId, ownLeads),
    inArray(leadTasks.authorUserId, ownAuthors),
  )!;
}

/** Status history / listing checks: tenant + (admin all · partner only own leads). */
export function leadChildWhere(
  table: typeof schema.leadStatusHistory | typeof schema.listingChecks,
  scope: ScopeContext,
  db: DB,
): SQL {
  const base = eq(table.tenantId, scope.tenantId);
  if (scope.role === "admin") return base;
  const ownLeads = db
    .select({ id: leads.id })
    .from(leads)
    // WP-J2 / DM-09b: a partner's owned-lead set excludes recalled (soft-deleted) leads, so the
    // guard is self-sufficient — child-table reads never rely on a parent join to filter deletes.
    .where(and(eq(leads.tenantId, scope.tenantId), partnerOwnsLead(requirePartner(scope)), isNull(leads.deletedAt)));
  return and(base, inArray(table.leadId, ownLeads))!;
}

/**
 * R-22/R-26: the status-history author predicate a partner is scoped to on lead_status_history.
 * A lead's status timeline follows ownership when the lead is re-routed (partnerOwnsLead moves the
 * effective owner), so a naive "entries on leads I own" read hands the NEW owner the PRIOR partner's
 * timeline. This restricts a partner to entries authored by their OWN org OR by an admin/system —
 * i.e. it hides only ANOTHER partner's entries (owner decision 2026-08-07). So a re-routed lead never
 * shows the prior partner's timeline, while an admin's inline status change on a currently-owned lead
 * stays visible to that owner (status is one shared field, unlike the two-stream notes model). Returns
 * undefined for admin (all entries). A raw SQL fragment so it composes into BOTH the query builders
 * (statusHistoryWhere / the write-path idempotency read) and the portal's raw correlated latest-status
 * subquery from one definition — the two never drift. The Postgres RLS backstop
 * (lead_status_history_scope, migration 0037) carries the identical predicate (SEC-01).
 */
export function ownStatusAuthorScope(scope: ScopeContext): SQL | undefined {
  if (scope.role === "admin") return undefined;
  const me = requirePartner(scope);
  return sql`${schema.leadStatusHistory.changedByUserId} in (select id from users where ${tenantWhere(schema.users, scope)} and (role = 'admin' or partner_id = ${me}))`;
}

/**
 * Status-history visibility: tenant + own-leads (leadChildWhere) AND — for a partner — only entries
 * authored by their own org (ownStatusAuthorScope), so a re-routed lead never carries the prior
 * partner's status timeline into the new owner's portal (R-22). Admin reads are unscoped by author.
 * Listing checks keep plain leadChildWhere — a system MLS check belongs to the lead, not a partner.
 */
export function statusHistoryWhere(scope: ScopeContext, db: DB): SQL {
  return and(leadChildWhere(schema.leadStatusHistory, scope, db), ownStatusAuthorScope(scope))!;
}
