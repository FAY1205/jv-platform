import { and, count, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { buildStateCoverage, type CoverageMapResponse } from "./map";

// MAP-01 read side. Admin-only surface (the route enforces role); every query is
// tenant-scoped through the guard (PRN-08). Statistics come from here, never
// re-derived in the UI (PRN-15). The payload shape lives in the pure `./map`
// module (the one canonical type); re-exported here for existing importers.
export type { CoverageMapResponse } from "./map";

/** The whole coverage-map payload: per-state ownership, gaps, legend, aggregates. */
export async function coverageMapData(scope: ScopeContext): Promise<CoverageMapResponse> {
  const db = getDb();

  const [stateRuleRows, partnerRows, leadByState, zipCov, unmatched, volume] = await Promise.all([
    db
      .select({ state: schema.stateRules.state, partnerId: schema.stateRules.partnerId })
      .from(schema.stateRules)
      .where(tenantWhere(schema.stateRules, scope)),
    db
      .select({
        id: schema.partners.id,
        name: schema.partners.name,
        refId: schema.partners.refId,
        color: schema.partners.color,
      })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt))),
    db
      .select({ state: schema.leads.state, n: sql<number>`count(*)::int` })
      .from(schema.leads)
      .where(and(tenantWhere(schema.leads, scope), eq(schema.leads.mlsStatus, "kept"), isNull(schema.leads.deletedAt)))
      .groupBy(schema.leads.state),
    db
      .select({ n: count() })
      .from(schema.coverageZips)
      .where(and(tenantWhere(schema.coverageZips, scope), isNull(schema.coverageZips.effectiveTo))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.leads)
      .where(
        and(
          tenantWhere(schema.leads, scope),
          eq(schema.leads.mlsStatus, "kept"),
          isNull(schema.leads.partnerId),
          // A manually-assigned lead is no longer a coverage gap (ASN-03).
          isNull(schema.leads.manualPartnerId),
          isNull(schema.leads.deletedAt), // WP-J2: a recalled lead isn't a coverage gap.
        ),
      ),
    db
      .select({
        keptTotal: sql<number>`count(*) filter (where ${schema.leads.mlsStatus} = 'kept')::int`,
        keptCovered: sql<number>`count(*) filter (where ${schema.leads.mlsStatus} = 'kept' and (${schema.leads.partnerId} is not null or ${schema.leads.manualPartnerId} is not null))::int`,
      })
      .from(schema.leads)
      .where(and(tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt))),
  ]);

  const keptTotal = Number(volume[0]?.keptTotal ?? 0);
  const keptCovered = Number(volume[0]?.keptCovered ?? 0);

  const leadCounts = leadByState
    .filter((r): r is { state: string; n: number } => Boolean(r.state))
    .map((r) => ({ state: r.state.toUpperCase(), count: Number(r.n) }));

  const model = buildStateCoverage(
    stateRuleRows.map((r) => ({ state: r.state, partnerId: r.partnerId })),
    partnerRows.map((p) => ({ id: p.id, name: p.name, refId: p.refId, color: p.color })),
    leadCounts,
  );

  return {
    ...model,
    zipCoverageCount: Number(zipCov[0]?.n ?? 0),
    unmatchedLeadCount: Number(unmatched[0]?.n ?? 0),
    keptLeadCount: keptTotal,
    coveredVolumePct: keptTotal === 0 ? 0 : keptCovered / keptTotal,
  };
}
