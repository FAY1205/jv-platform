import { and, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { releasedLeads } from "@/lib/hold-filter";

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
  /** `admin`/`member`/`viewer` are the ADMIN-STREAM tiers (Phase C); `partner` is the other
   *  stream (PRN-13). Data shape branches ONLY on the stream (isPartnerStream) — tier
   *  allow/deny lives in lib/authz.ts. Note: `member`/`viewer` exist in the type ahead of the
   *  enum migration; no row carries them until the Phase C schema PR lands. */
  role: "admin" | "partner" | "member" | "viewer";
  userId: string;
  /** Required when role === "partner". */
  partnerId?: string;
  /** Tenant-CONFIGURED capability set for member/viewer tiers, resolved once per request by
   *  getServerScope (Phase C schema WP). Absent ⇒ lib/authz falls back to the code defaults.
   *  Typed as strings to avoid a scope↔authz import cycle; lib/authz owns the Capability union
   *  and is the only reader. Never consulted for admin (locked-full) or partner (stream). */
  capabilities?: ReadonlySet<string>;
}

/**
 * THE stream predicate (Phase C). Every data-shape decision — which arm of a scope builder,
 * which note/task stream, hold-window applicability — keys on this, never on `role === "admin"`:
 * a literal admin comparison would silently send the other admin-stream tiers (member/viewer)
 * down the partner arm. Allow/deny (who may void, export, manage) is lib/authz.ts's job.
 */
export function isPartnerStream(scope: ScopeContext): boolean {
  return scope.role === "partner";
}

/** The PRN-13 stream a scope writes/reads: feeds `author_role` on notes/tasks. The author_role
 *  enum stays strictly binary — admin-stream tiers all write the 'admin' stream. */
export function streamOf(scope: ScopeContext): "admin" | "partner" {
  return isPartnerStream(scope) ? "partner" : "admin";
}

/** Guard: a partner scope must carry a partnerId, or it is a programming error. */
export function requirePartner(scope: ScopeContext): string {
  if (scope.role === "partner" && !scope.partnerId) {
    throw new Error("Partner scope is missing partnerId — refusing to build an unscoped query.");
  }
  return scope.partnerId as string;
}

/**
 * The shape a stream-membership predicate needs: `users` ITSELF or one of its aliases.
 * Drizzle bakes the table name into every column type, so an alias is not assignable to
 * `typeof schema.users` — structural, so the write path (the real table) and the C-11
 * identity joins (two aliases) compose the SAME builder rather than a private copy.
 */
export interface StreamUsersTable {
  role: PgColumn;
  partnerId: PgColumn;
}

/**
 * C-47 — THE "which users belong to this stream/org" predicate. ONE definition; four call
 * sites compose it (`noteWhere`/`taskWhere`'s `ownAuthors`, `statusAuthorOrg`, and the tasks
 * module's assignee resolution + identity joins), so a stream-tier change lands once instead
 * of four times (audit-tenancy F-1 on C-11; the ENGINEERING_STANDARDS §2 house rule).
 *
 * Staff arm `role <> 'partner'` (never `= 'admin'`): every admin-STREAM tier — admin, member,
 * viewer — is one stream (PRN-13 stays binary), so a widened enum can't silently split it.
 * Partner arm checks role AND org because `users.partner_id` carries NO role invariant
 * (SCP-01 / C-15, ADR-0046): an admin row with a stray partner_id must never count into a
 * partner org's member set.
 *
 * RLS parity, precisely (audit-tenancy F-2): migrations 0044 / 0054 carry the twin of this
 * predicate on the AUTHOR/READ axis — `lead_tasks_scope` / `lead_notes_scope` USING pin
 * `author_user_id in (select id from users where tenant_id = … and partner_id = … and role =
 * 'partner')`. Keep THOSE halves in lockstep. The ASSIGNEE arm is deliberately NOT twinned:
 * `lead_tasks_scope`'s WITH CHECK admits any in-tenant `assigned_to_user_id`, while
 * `resolveAssignee` additionally requires the caller's own stream AND an active seat. The app
 * is STRICTER than the database — the safe direction, since the builders are the primary
 * boundary and RLS is the backstop (ENGINEERING_STANDARDS §2). Tightening the WITH CHECK to
 * match is a logged WP candidate, not a correctness gap here.
 *
 * NOT keyed on a ScopeContext: `statusAuthorOrg` needs the OTHER stream's arm for a partner
 * caller (a partner's status timeline admits staff authors too), so the stream is a parameter.
 * `sameStreamUsersWhere` is the caller's-own-arm wrapper every other site wants.
 */
export function streamUsersWhere(t: StreamUsersTable, stream: "admin" | "partner", partnerId?: string): SQL {
  if (stream === "admin") return ne(t.role, "partner");
  if (!partnerId) {
    throw new Error("streamUsersWhere: the partner arm needs a partnerId — refusing to build an unscoped query.");
  }
  return and(eq(t.role, "partner"), eq(t.partnerId, partnerId))!;
}

/** The user rows of the CALLER'S OWN stream: staff see staff, a partner sees their own org.
 *  Pair it with `tenantWhere(t, scope)` — this builder decides the stream, never the tenant. */
export function sameStreamUsersWhere(scope: ScopeContext, t: StreamUsersTable): SQL {
  return isPartnerStream(scope)
    ? streamUsersWhere(t, "partner", requirePartner(scope))
    : streamUsersWhere(t, "admin");
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

/** Leads visibility: tenant + (admin stream sees all · partner sees only their own). */
export function leadWhere(scope: ScopeContext): SQL {
  const base = eq(leads.tenantId, scope.tenantId);
  if (!isPartnerStream(scope)) return base;
  return and(base, partnerOwnsLead(requirePartner(scope)))!;
}

/**
 * Lead notes visibility (PRN-13): admin sees only admin notes; a partner sees only
 * their own partner notes on their own leads. Cross-role notes are never returned.
 */
export function noteWhere(scope: ScopeContext, db: DB, now?: Date): SQL {
  const base = eq(leadNotes.tenantId, scope.tenantId);
  if (!isPartnerStream(scope)) {
    return and(base, eq(leadNotes.authorRole, "admin"))!;
  }
  const me = requirePartner(scope);
  const ownLeads = db
    .select({ id: leads.id })
    .from(leads)
    // WP-J2 / DM-09b: a partner's owned-lead set excludes recalled (soft-deleted) leads, so the
    // guard is self-sufficient — child-table reads never rely on a parent join to filter deletes.
    // C-8 / WP-TSK-2a: it also excludes STILL-HELD leads (distribution hold), so noteWhere carries
    // the hold itself rather than leaning on a lead-resolution conjunct. The RLS counterpart
    // (lead_notes_scope, migration 0047) carries the identical predicate in USING + WITH CHECK.
    .where(and(eq(leads.tenantId, scope.tenantId), partnerOwnsLead(me), isNull(leads.deletedAt), releasedLeads(now)));
  // A note belongs to the partner org that wrote it (PRN-08/PRN-13): lead ownership MOVES
  // on re-route (partnerOwnsLead), so "notes on leads I own" alone would hand the previous
  // partner's notes to the new one. Restrict to notes authored by the reading partner's own org.
  // C-47: the ONE stream-membership builder above (SCP-01 / C-15, ADR-0046 — role AND org,
  // because users.partner_id carries no role invariant). The RLS counterpart (0044) carries
  // the same predicate. (statusAuthorOrg deliberately unions the STAFF arm on top: admin
  // status changes stay visible to the current owner — one field, not two streams.)
  const ownAuthors = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, scope.tenantId), streamUsersWhere(users, "partner", me)));
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
 * noteWhere does for notes. The RLS policy lead_tasks_scope (migration 0041, hold added
 * in 0047) carries the identical READ predicate, and its WITH CHECK additionally pins author
 * identity, stream, and in-tenant references on writes (SEC-01; audit-tenancy F-1) — keep both
 * halves in lockstep with this builder.
 *
 * C-8 / WP-TSK-2a: the partner arm also carries the DISTRIBUTION HOLD (releasedLeads) directly,
 * so the two paths that don't resolve a lead first — resolveTask (mutation by task id) and the
 * cross-lead My Tasks list — are hold-gated by the guard itself, not a separate compensator.
 * `now` lets the TSK-08 reminder sweep inject its clock (taskVisibleTo); request paths default it.
 */
export function taskWhere(scope: ScopeContext, db: DB, now?: Date): SQL {
  const base = eq(leadTasks.tenantId, scope.tenantId);
  if (!isPartnerStream(scope)) {
    return and(base, eq(leadTasks.authorRole, "admin"))!;
  }
  const me = requirePartner(scope);
  const ownLeads = db
    .select({ id: leads.id })
    .from(leads)
    // DM-09b: recalled (soft-deleted) leads drop out of the owned set here, so task reads
    // never rely on a parent join to filter deletes (same discipline as noteWhere).
    // C-8 / WP-TSK-2a: still-HELD leads drop out too (distribution hold), so the guard is
    // self-sufficient and app + RLS (0047) carry the hold in lockstep.
    .where(and(eq(leads.tenantId, scope.tenantId), partnerOwnsLead(me), isNull(leads.deletedAt), releasedLeads(now)));
  // C-47: the ONE stream-membership builder above (SCP-01 / C-15, ADR-0046 — role AND org,
  // because users.partner_id carries no role invariant). The RLS counterpart (0044) carries
  // the same predicate; the tasks module's assignee + identity paths compose the same builder
  // through `sameStreamUsersWhere`, so read visibility and write validation cannot disagree.
  const ownAuthors = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, scope.tenantId), streamUsersWhere(users, "partner", me)));
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
  if (!isPartnerStream(scope)) return base;
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
  if (!isPartnerStream(scope)) return undefined;
  return sql`${schema.leadStatusHistory.changedByUserId} in ${statusAuthorOrg(scope, requirePartner(scope))}`;
}

/**
 * The author set a partner's status timeline is restricted to: their OWN org, plus any
 * admin-STREAM tier. `role <> 'partner'` (not `= 'admin'`): a status change by ANY staff tier
 * (admin, and later member) stays visible to the owning partner — the same intentional
 * semantic, generalized (equivalent for all existing rows; the RLS twin migrates in the Phase C
 * schema PR). ONE definition (audit-tenancy F-3 / R-24): the raw analytics SQL in
 * modules/analytics/partner-performance.ts composes this same fragment, so the portal timeline
 * and the portal's own KPI numbers can never disagree about whose touch counts (PRN-15).
 *
 * C-47: the two arms are now the shared `streamUsersWhere` builder — this is the ONE site that
 * unions BOTH streams, which is exactly why the builder takes the stream as a parameter rather
 * than reading it off the scope. SQL-equivalent to the previous `role <> 'partner' or
 * partner_id = $p`: the partner arm's added `role = 'partner'` conjunct can only matter for a
 * row the staff arm already admits. It stays a raw `sql` fragment so it keeps composing into
 * the analytics template and the portal's correlated latest-status subquery (drizzle
 * predicates interpolate into sql`` unchanged).
 */
export function statusAuthorOrg(scope: ScopeContext, partnerId: string): SQL {
  const anyStaffOrOwnOrg = or(streamUsersWhere(users, "admin"), streamUsersWhere(users, "partner", partnerId))!;
  return sql`(select id from users where ${tenantWhere(schema.users, scope)} and ${anyStaffOrOwnOrg})`;
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
