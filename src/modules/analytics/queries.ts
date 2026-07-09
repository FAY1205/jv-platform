import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { buildAnalytics, type AnalyticsResult } from "./overview";
import {
  buildPeriodSummary,
  bucketByWeek,
  periodRange,
  type Period,
  type PeriodSummary,
  type WeekBucket,
} from "./periods";
import { campaignQuality, type CampaignQuality } from "./source-quality";
import { partnerPerformance, sourcePerformance, type PartnerPerf, type SourcePerf } from "./performance";
import { currentStatus, DEFAULT_STATUS } from "../portal/statuses";

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
  /** Per-campaign volume + removal rate — lead-source quality (ANA-02). */
  campaigns: CampaignQuality[];
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
        campaign: schema.leads.campaign,
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

  const campaigns = campaignQuality(leadRows.map((l) => ({ campaign: l.campaign, mlsStatus: l.mlsStatus })));

  return { ...result, partnerTotals, weekly, campaigns };
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

export interface DashboardPartnerPerf extends PartnerPerf {
  name: string;
  refId: string;
  color: string;
}
export interface DashboardData {
  summary: PeriodSummary;
  weekly: WeekBucket[];
  partners: DashboardPartnerPerf[];
  sources: SourcePerf[];
  coveredVolumePct: number;
  keptLeadCount: number;
}

/** Everything the unified dashboard needs, from a single lead+status fetch.
 *  Performance is event-scoped to the selected period; KPIs/trend as before.
 *  All numbers originate here (PRN-15); `now` is stamped once. */
export async function dashboardData(scope: ScopeContext, period: Period): Promise<DashboardData> {
  const db = getDb();
  const now = new Date();
  const range = periodRange(period, now);

  const effectivePartner = sql<string | null>`coalesce(${schema.leads.manualPartnerId}, ${schema.leads.partnerId})`;
  const [leadRows, historyRows, partnerRows] = await Promise.all([
    db
      .select({
        id: schema.leads.id,
        partnerId: effectivePartner,
        campaign: schema.leads.campaign,
        mlsStatus: schema.leads.mlsStatus,
        previouslyMatched: schema.leads.previouslyMatched,
        createdAt: schema.leads.createdAt,
      })
      .from(schema.leads)
      .where(and(tenantWhere(schema.leads, scope), isNull(schema.leads.deletedAt))),
    db
      .select({ leadId: schema.leadStatusHistory.leadId, status: schema.leadStatusHistory.status, createdAt: schema.leadStatusHistory.createdAt })
      .from(schema.leadStatusHistory)
      .where(tenantWhere(schema.leadStatusHistory, scope)),
    db
      .select({ id: schema.partners.id, name: schema.partners.name, refId: schema.partners.refId, color: schema.partners.color })
      .from(schema.partners)
      .where(and(tenantWhere(schema.partners, scope), isNull(schema.partners.deletedAt))),
  ]);

  const histByLead = new Map<string, { status: string; createdAt: string }[]>();
  for (const h of historyRows) {
    const list = histByLead.get(h.leadId) ?? [];
    list.push({ status: h.status, createdAt: h.createdAt.toISOString() });
    histByLead.set(h.leadId, list);
  }

  const perfLeads = leadRows.map((l) => {
    const h = histByLead.get(l.id) ?? [];
    const sorted = [...h].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const firstTouchAt = sorted.find((e) => e.status !== DEFAULT_STATUS)?.createdAt ?? null;
    const closedAt = [...sorted].reverse().find((e) => e.status === "Closed")?.createdAt ?? null;
    return {
      partnerId: l.partnerId,
      campaign: l.campaign,
      mlsStatus: l.mlsStatus,
      receivedAt: l.createdAt.toISOString(),
      firstTouchAt,
      closedAt,
      currentStatus: currentStatus(h),
    };
  });

  const partnerById = new Map(partnerRows.map((p) => [p.id, p]));
  const partners: DashboardPartnerPerf[] = partnerPerformance(range, perfLeads).map((pp) => {
    const meta = partnerById.get(pp.partnerId);
    return { ...pp, name: meta?.name ?? "Unknown partner", refId: meta?.refId ?? "—", color: meta?.color ?? "var(--text-3)" };
  });

  const summary = buildPeriodSummary(
    leadRows.map((l) => ({ receivedAt: l.createdAt.toISOString(), mlsStatus: l.mlsStatus, partnerId: l.partnerId, previouslyMatched: l.previouslyMatched })),
    period,
    now,
  );
  const weekly = bucketByWeek(
    leadRows.map((l) => ({ receivedAt: l.createdAt.toISOString(), mlsStatus: l.mlsStatus, partnerId: l.partnerId, previouslyMatched: l.previouslyMatched })),
  );

  const kept = leadRows.filter((l) => l.mlsStatus === "kept");
  const keptCovered = kept.filter((l) => l.partnerId !== null).length;

  return {
    summary,
    weekly,
    partners,
    sources: sourcePerformance(range, perfLeads),
    keptLeadCount: kept.length,
    coveredVolumePct: kept.length === 0 ? 0 : keptCovered / kept.length,
  };
}
