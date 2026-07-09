import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { buildAnalytics, type AnalyticsResult } from "./overview";
import {
  buildPeriodSummary,
  bucketByWeek,
  type Period,
  type PeriodSummary,
  type WeekBucket,
} from "./periods";

// ANA-01 read side. Admin-only (the route enforces role); tenant-scoped through
// the guard (PRN-08). Fetches minimal per-lead fields + run/partner metadata and
// hands them to the pure aggregator (PRN-15).

export interface AnalyticsPartnerTotal {
  partnerId: string;
  name: string;
  refId: string;
  color: string;
  count: number;
}

export interface AnalyticsResponse extends Omit<AnalyticsResult, "partnerTotals"> {
  partnerTotals: AnalyticsPartnerTotal[];
  /** Weekly trend series (zero-filled gaps make skipped weeks visible). */
  weekly: WeekBucket[];
}

export async function analyticsOverview(scope: ScopeContext): Promise<AnalyticsResponse> {
  const db = getDb();

  const [leadRows, runRows, partnerRows] = await Promise.all([
    db
      .select({
        uploadId: schema.leads.uploadId,
        mlsStatus: schema.leads.mlsStatus,
        matchMethod: schema.leads.matchMethod,
        partnerId: schema.leads.partnerId,
        mlsReason: schema.leads.mlsReason,
        previouslyMatched: schema.leads.previouslyMatched,
        createdAt: schema.leads.createdAt,
      })
      .from(schema.leads)
      .where(and(tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt))),
    db
      .select({ uploadId: schema.uploads.id, refId: schema.uploads.refId, createdAt: schema.uploads.createdAt })
      .from(schema.uploads)
      .where(and(tenantWhere(schema.uploads, scope), eq(schema.uploads.status, "processed"), isNull(schema.uploads.voidedAt))),
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt))),
  ]);

  const result = buildAnalytics(
    leadRows.map((l) => ({
      uploadId: l.uploadId,
      mlsStatus: l.mlsStatus,
      matchMethod: l.matchMethod,
      partnerId: l.partnerId,
      mlsReason: l.mlsReason,
      previouslyMatched: l.previouslyMatched,
    })),
    runRows.map((r) => ({ uploadId: r.uploadId, refId: r.refId, createdAt: r.createdAt.toISOString() })),
  );

  const partnerById = new Map(partnerRows.map((p) => [p.id, p]));
  const partnerTotals: AnalyticsPartnerTotal[] = result.partnerTotals.map((t) => {
    const p = partnerById.get(t.partnerId);
    return {
      partnerId: t.partnerId,
      name: p?.name ?? "Unknown partner",
      refId: p?.refId ?? "—",
      color: p?.color ?? "var(--text-3)",
      count: t.count,
    };
  });

  const weekly = bucketByWeek(
    leadRows.map((l) => ({
      receivedAt: l.createdAt.toISOString(),
      mlsStatus: l.mlsStatus,
      partnerId: l.partnerId,
      previouslyMatched: l.previouslyMatched,
    })),
  );

  return { ...result, partnerTotals, weekly };
}

/** Period KPIs for the dashboard (week/month/year/all + deltas vs the same
 *  elapsed span of the previous period). `now` is stamped here — the pure math
 *  in periods.ts never reads the clock (PRN-01). */
export async function periodSummary(scope: ScopeContext, period: Period): Promise<PeriodSummary> {
  const db = getDb();
  const leadRows = await db
    .select({
      mlsStatus: schema.leads.mlsStatus,
      partnerId: schema.leads.partnerId,
      previouslyMatched: schema.leads.previouslyMatched,
      createdAt: schema.leads.createdAt,
    })
    .from(schema.leads)
    .where(and(tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt)));

  return buildPeriodSummary(
    leadRows.map((l) => ({
      receivedAt: l.createdAt.toISOString(),
      mlsStatus: l.mlsStatus,
      partnerId: l.partnerId,
      previouslyMatched: l.previouslyMatched,
    })),
    period,
    new Date(),
  );
}
