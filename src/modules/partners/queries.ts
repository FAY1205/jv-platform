import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, partnerOwnsLead, type ScopeContext } from "@/lib/scope";
import { currentStatus, DEFAULT_STATUS } from "../portal/statuses";
import { computePartnerHealth, type PartnerHealth } from "./health";

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
  /** Accountability (ANA-02): untouched backlog + responsiveness. */
  untouched: number;
  oldestUntouchedDays: number;
  avgFirstTouchHours: number | null;
}

/** Per-partner health, keyed by partner id. Reads each owned kept lead's status
 *  history to derive current status + first-touch time (ANA-02). */
async function healthByPartner(scope: ScopeContext): Promise<Map<string, PartnerHealth>> {
  const db = getDb();
  const effectivePartner = sql<string>`coalesce(${schema.leads.manualPartnerId}, ${schema.leads.partnerId})`;
  const owned = await db
    .select({ id: schema.leads.id, partnerId: effectivePartner, createdAt: schema.leads.createdAt })
    .from(schema.leads)
    .where(
      and(
        tenantWhere(schema.leads, scope),
        eq(schema.leads.mlsStatus, "kept"),
        isNull(schema.leads.deletedAt),
        sql`coalesce(${schema.leads.manualPartnerId}, ${schema.leads.partnerId}) is not null`,
      ),
    );
  if (owned.length === 0) return new Map();

  const history = await db
    .select({ leadId: schema.leadStatusHistory.leadId, status: schema.leadStatusHistory.status, createdAt: schema.leadStatusHistory.createdAt })
    .from(schema.leadStatusHistory)
    .where(tenantWhere(schema.leadStatusHistory, scope));
  const byLead = new Map<string, { status: string; createdAt: string }[]>();
  for (const h of history) {
    const list = byLead.get(h.leadId) ?? [];
    list.push({ status: h.status, createdAt: h.createdAt.toISOString() });
    byLead.set(h.leadId, list);
  }

  return computePartnerHealth(
    new Date(),
    owned.map((l) => {
      const h = byLead.get(l.id) ?? [];
      const firstOff = [...h]
        .filter((e) => e.status !== DEFAULT_STATUS)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      return {
        partnerId: l.partnerId,
        receivedAt: l.createdAt.toISOString(),
        currentStatus: currentStatus(h),
        firstTouchAt: firstOff?.createdAt ?? null,
      };
    }),
  );
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

  // Effective delivered count per partner: pipeline routing OR manual assignment.
  const effectivePartner = sql<string>`coalesce(${schema.leads.manualPartnerId}, ${schema.leads.partnerId})`;
  const counts = await db
    .select({ partnerId: effectivePartner, n: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(and(tenantWhere(schema.leads, scope), eq(schema.leads.mlsStatus, "kept")))
    .groupBy(effectivePartner);
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

  const health = await healthByPartner(scope);

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
    untouched: health.get(p.id)?.untouched ?? 0,
    oldestUntouchedDays: health.get(p.id)?.oldestUntouchedDays ?? 0,
    avgFirstTouchHours: health.get(p.id)?.avgFirstTouchHours ?? null,
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
        partnerOwnsLead(partnerId), // pipeline-routed OR manually assigned (ASN-03)
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
