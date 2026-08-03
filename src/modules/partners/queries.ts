import { and, count, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, partnerOwnsLead, type ScopeContext } from "@/lib/scope";

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
  /** WP-D: the tenant's own house territory (never invited/deactivated; coverage-only). */
  isHouse: boolean;
  invitedAt: string | null;
  activatedAt: string | null;
  lastPortalLoginAt: string | null;
  /** Current coverage: ZIPs + whole states this partner owns (CVG-01). */
  zipCount: number;
  stateCount: number;
}

export interface Territory {
  states: string[];
  zips: string[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The active roster (deactivated partners are excluded) — a pure management table.
 *  Lead-count / responsiveness stats live on the per-partner profile now (F-10: the
 *  full-history health scan is off the roster path). */
export async function listPartners(scope: ScopeContext): Promise<PartnerRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.partners)
    .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt)))
    .orderBy(schema.partners.refId);

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
    isHouse: p.isHouse,
    invitedAt: iso(p.invitedAt),
    activatedAt: iso(p.activatedAt),
    lastPortalLoginAt: iso(p.lastPortalLoginAt),
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

export interface PartnerLeadSummary {
  refId: string;
  seller: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** How the lead reached this partner — ZIP, state fallback (ASN-01), or a
   *  manual admin assignment (ASN-03). */
  matchMethod: "zip" | "state_fallback" | "none" | "manual";
  receivedAt: string;
}

/** The partner's most recent kept leads (admin lead history for the detail page). */
export async function recentLeadsForPartner(
  scope: ScopeContext,
  partnerId: string,
  limit = 25,
): Promise<PartnerLeadSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      refId: schema.leads.refId,
      sellerFirst: schema.leads.sellerFirst,
      sellerLast: schema.leads.sellerLast,
      city: schema.leads.city,
      state: schema.leads.state,
      zip: schema.leads.zip,
      matchMethod: schema.leads.matchMethod,
      manualPartnerId: schema.leads.manualPartnerId,
      createdAt: schema.leads.createdAt,
    })
    .from(schema.leads)
    .where(
      and(
        tenantWhere(schema.leads, scope),
        partnerOwnsLead(partnerId), // effective owner: manual overlay, else pipeline snapshot (ASN-03)
        eq(schema.leads.mlsStatus, "kept"),
        isNull(schema.leads.deletedAt),
      ),
    )
    .orderBy(desc(schema.leads.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    refId: r.refId,
    matchMethod: r.manualPartnerId ? ("manual" as const) : r.matchMethod,
    seller: `${r.sellerFirst ?? ""} ${r.sellerLast ?? ""}`.trim() || "—",
    city: r.city,
    state: r.state,
    zip: r.zip,
    receivedAt: r.createdAt.toISOString(),
  }));
}

/** A single partner (active roster) with its current territory, or null. Fetches the
 *  one row directly — no roster recompute (F-10). */
export async function getPartner(
  scope: ScopeContext,
  partnerId: string,
): Promise<(PartnerRow & { territory: Territory }) | null> {
  const db = getDb();
  const [p] = await db
    .select()
    .from(schema.partners)
    .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.id, partnerId), isNull(schema.partners.deletedAt)))
    .limit(1);
  if (!p) return null;

  const [zips, states, territory] = await Promise.all([
    db.select({ n: count() }).from(schema.coverageZips).where(and(tenantWhere(schema.coverageZips, scope), eq(schema.coverageZips.partnerId, partnerId), isNull(schema.coverageZips.effectiveTo))),
    db.select({ n: count() }).from(schema.stateRules).where(and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.partnerId, partnerId))),
    territoryOf(scope, partnerId),
  ]);

  return {
    id: p.id,
    refId: p.refId,
    name: p.name,
    email: p.email,
    phone: p.phone,
    color: p.color,
    dealTerms: p.dealTerms,
    adminNotes: p.adminNotes,
    status: p.status,
    isHouse: p.isHouse,
    invitedAt: iso(p.invitedAt),
    activatedAt: iso(p.activatedAt),
    lastPortalLoginAt: iso(p.lastPortalLoginAt),
    zipCount: Number(zips[0]?.n ?? 0),
    stateCount: Number(states[0]?.n ?? 0),
    territory,
  };
}
