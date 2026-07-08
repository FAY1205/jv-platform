import { and, count, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";

// ADM-03 read side. Every query is tenant-scoped through the guard (PRN-08).
// Admin-only surface (the routes enforce role); partners never reach these.

export interface PartnerRow {
  id: string;
  refId: string;
  name: string;
  email: string | null;
  phone: string | null;
  color: string;
  dealTerms: string | null;
  adminNotes: string | null;
  status: "not_invited" | "invited" | "active" | "revoked";
  invitedAt: string | null;
  activatedAt: string | null;
  lastPortalLoginAt: string | null;
  /** Kept leads assigned to this partner (simple count; full stats → WP-029). */
  leadCount: number;
  /** Current coverage: ZIPs + whole states this partner owns (CVG-01). */
  zipCount: number;
  stateCount: number;
}

export interface Territory {
  states: string[];
  zips: string[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The active roster (deactivated partners are excluded), each with a lead count. */
export async function listPartners(scope: ScopeContext): Promise<PartnerRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.partners)
    .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt)))
    .orderBy(schema.partners.refId);

  const counts = await db
    .select({ partnerId: schema.leads.partnerId, n: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(and(tenantWhere(schema.leads, scope), eq(schema.leads.mlsStatus, "kept")))
    .groupBy(schema.leads.partnerId);
  const countBy = new Map(counts.map((c) => [c.partnerId, Number(c.n)]));

  const zipCounts = await db
    .select({ partnerId: schema.coverageZips.partnerId, n: count() })
    .from(schema.coverageZips)
    .where(and(tenantWhere(schema.coverageZips, scope), isNull(schema.coverageZips.effectiveTo)))
    .groupBy(schema.coverageZips.partnerId);
  const zipBy = new Map(zipCounts.map((c) => [c.partnerId, Number(c.n)]));

  const stateCounts = await db
    .select({ partnerId: schema.stateRules.partnerId, n: count() })
    .from(schema.stateRules)
    .where(tenantWhere(schema.stateRules, scope))
    .groupBy(schema.stateRules.partnerId);
  const stateBy = new Map(stateCounts.map((c) => [c.partnerId, Number(c.n)]));

  return rows.map((p) => ({
    id: p.id,
    refId: p.refId,
    name: p.name,
    email: p.email,
    phone: p.phone,
    color: p.color,
    dealTerms: p.dealTerms,
    adminNotes: p.adminNotes,
    status: p.status,
    invitedAt: iso(p.invitedAt),
    activatedAt: iso(p.activatedAt),
    lastPortalLoginAt: iso(p.lastPortalLoginAt),
    leadCount: countBy.get(p.id) ?? 0,
    zipCount: zipBy.get(p.id) ?? 0,
    stateCount: stateBy.get(p.id) ?? 0,
  }));
}

/** The current territory a partner owns (for the deactivation prompt). */
export async function territoryOf(scope: ScopeContext, partnerId: string): Promise<Territory> {
  const db = getDb();
  const [states, zips] = await Promise.all([
    db
      .select({ state: schema.stateRules.state })
      .from(schema.stateRules)
      .where(and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.partnerId, partnerId)))
      .orderBy(schema.stateRules.state),
    db
      .select({ zip5: schema.coverageZips.zip5 })
      .from(schema.coverageZips)
      .where(
        and(
          tenantWhere(schema.coverageZips, scope),
          eq(schema.coverageZips.partnerId, partnerId),
          isNull(schema.coverageZips.effectiveTo),
        ),
      )
      .orderBy(schema.coverageZips.zip5),
  ]);
  return { states: states.map((s) => s.state), zips: zips.map((z) => z.zip5) };
}

/** A single partner (active roster) with its current territory, or null. */
export async function getPartner(
  scope: ScopeContext,
  partnerId: string,
): Promise<(PartnerRow & { territory: Territory }) | null> {
  const list = await listPartners(scope);
  const partner = list.find((p) => p.id === partnerId);
  if (!partner) return null;
  const territory = await territoryOf(scope, partnerId);
  return { ...partner, territory };
}
