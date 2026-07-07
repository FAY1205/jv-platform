import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// The scoping guard (PRN-08). Every query in API routes builds its WHERE clause
// from here — tenant scoping is enforced in application code AND in Postgres RLS
// (SEC-01). The client is never trusted. These builders are the app-layer half;
// the RLS policies (0001 migration) are the database half. TST-01 proves both.
// ─────────────────────────────────────────────────────────────────────────────

const { leads, leadNotes } = schema;
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

/** Leads visibility: tenant + (admin sees all · partner sees only their own). */
export function leadWhere(scope: ScopeContext): SQL {
  const base = eq(leads.tenantId, scope.tenantId);
  if (scope.role === "admin") return base;
  return and(base, eq(leads.partnerId, requirePartner(scope)))!;
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
  const ownLeads = db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.tenantId, scope.tenantId), eq(leads.partnerId, requirePartner(scope))));
  return and(base, eq(leadNotes.authorRole, "partner"), inArray(leadNotes.leadId, ownLeads))!;
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
    .where(and(eq(leads.tenantId, scope.tenantId), eq(leads.partnerId, requirePartner(scope))));
  return and(base, inArray(table.leadId, ownLeads))!;
}
